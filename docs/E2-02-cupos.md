# E2-02 — Cupos garantizados por la base de datos

## Qué se garantiza
Las postulaciones `ACCEPTED` de una oferta no superan sus `seats`, **aunque dos aceptaciones lleguen a la vez y aunque el cambio no pase por `ApplicationService`**. Con la última plaza libre, exactamente una tiene éxito y la otra recibe `400 "la oferta ya no tiene cupos"` (el mismo mensaje que el chequeo previo, no un error genérico).

## Decisión: trigger con bloqueo de fila, no solo código
La historia pide elegir entre una transacción con bloqueo de fila y una restricción en la base que haga imposible el estado inválido, y dejar escrito por qué.

| Opción | Problema |
|---|---|
| Transacción en `decide` con `SELECT … FOR UPDATE` sobre la oferta | Funciona, pero **solo para quien use `decide`**. Otro servicio, un script o un `UPDATE` a mano vuelven a abrir la ventana. Es una garantía de la aplicación, no de la base. |
| `CHECK` o índice único | Un `CHECK` no puede contar filas de otra tabla y un índice único no expresa "a lo sumo N". No sirven para un límite variable por oferta. |
| **Trigger `enforce_offer_seats` (elegida)** | Se ejecuta dentro del `UPDATE`, así que ningún camino lo salta. Bloquea la fila de la oferta antes de contar: dos aceptaciones simultáneas se serializan y la segunda ve la aceptada de la primera. |

El chequeo de `decide` (`acceptedCount`) se **mantiene solo como atajo** para fallar sin escribir. Ya no es la garantía: entre esa lectura y el `UPDATE` sigue existiendo la ventana (E2-01), y el trigger es lo que la cierra. Es el mismo principio de E1-03b, E3-02 y E3-03: la exclusividad la da la base, no una lectura previa.

## Alcance del trigger (a propósito)
- **Protege las transiciones a `ACCEPTED`** (`BEFORE UPDATE OF status, offerId`), la única vía del producto.
- **No bloquea reescribir una aceptada que sigue aceptada**, para no romper ofertas que hoy ya están llenas.
- **No protege los `INSERT` directos con `ACCEPTED`.** `prisma/seed.ts` los usa, y el seed deja **36 de 37 ofertas con más aceptadas que cupos** (cupos de 2 a 5 con unas 5 postulaciones aceptadas cada una). Bloquear el `INSERT` rompería `pnpm db:seed`. Ninguna ruta de la aplicación inserta postulaciones aceptadas (`apply` crea `SUBMITTED`).
- **Liberar un cupo funciona**: pasar la aceptada a `WITHDRAWN`/`REJECTED` deja aceptar a otra.

## Cómo se prueba
`src/application/application-seats-e2e.spec.ts`, contra Postgres real, con la barrera de E2-01 que fuerza el peor intercalado (las dos llamadas leen antes de que cualquiera escriba):

- Con 1 plaza y 2 aceptaciones simultáneas: exactamente una pasa, 3 repeticiones; la otra recibe `BadRequestException('la oferta ya no tiene cupos')`.
- Con 2 plazas pasan las dos (aceptar sigue funcionando con cupos de sobra).
- **`UPDATE` directo con Prisma, saltándose los servicios: la base lo rechaza** (`offer_full`).
- Una aceptada que se reescribe no se bloquea; liberar un cupo permite aceptar a la otra.
- Estable: 5 corridas seguidas. La migración y el seed se verificaron desde cero en una base temporal.

## Pendiente
- **Corregir el seed** para que respete los cupos (hoy nace sobrecupado) y entonces proteger también el `INSERT`. Queda anotado como D-11 en `KNOWN_ISSUES.md`.
- `decide` sigue leyendo el estado de la postulación y escribiendo después: dos decisiones simultáneas **sobre la misma postulación** pueden pisarse. No es sobrecupo; queda como seguimiento.
