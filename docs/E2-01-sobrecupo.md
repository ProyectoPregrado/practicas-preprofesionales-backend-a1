# E2-01 — Demostración del sobrecupo

## Qué se demuestra
Con una oferta de **una sola plaza libre**, dos aceptaciones simultáneas pasan **las dos** y la oferta queda con 2 postulaciones `ACCEPTED`. Se rompe la regla "las postulaciones aceptadas de una oferta no superan sus cupos (`seats`)".

## Dónde está la ventana
`src/application/application.service.ts`, método `decide`:

| Línea | Qué hace |
|---|---|
| 76 | `const accepted = await this.offers.acceptedCount(application.offerId)` — **lee** cuántas hay aceptadas |
| 77 | `if (accepted >= offer.seats) throw …` — **decide** con ese número |
| 80 | `return this.prisma.application.update({ … status … })` — **escribe** |

Es un "leer para decidir y después escribir" en pasos separados, sin bloqueo ni restricción en la base. Si dos llamadas llegan a la línea 76 antes de que cualquiera llegue a la 80, las dos ven `accepted = 0`, las dos pasan la línea 77 y las dos escriben en la 80. Es el mismo patrón que E1-03 (dedupe de `clientOpId`) y que E3-03 (refresh token), en otro endpoint.

## Cómo se prueba sin depender de la suerte
`src/application/application-seats-e2e.spec.ts`, contra **Postgres real**:

- Una barrera dentro de `acceptedCount` (`BarrierOfferService`) hace que las dos llamadas **lean** antes de que cualquiera **escriba**. Es el peor intercalado posible y se fuerza siempre, sin `sleep` ni repeticiones esperando un golpe de suerte.
- Tres repeticiones documentan que ambas aceptaciones pasan y que `accepted = 2`.
- La invariante `aceptadas <= cupos` está como `it.fails`: hoy falla (es el bug real) y la CI sigue en verde. **E2-02 la convierte en un `it` normal.**
- Estable: 5 corridas seguidas (20 tests) con el mismo resultado. El test crea sus propias filas y las borra al terminar.

## Cómo correrlo
```bash
docker compose up -d && pnpm db:deploy
pnpm vitest run src/application/application-seats-e2e.spec.ts
```
Si el puerto 5432 está ocupado por otro contenedor: `POSTGRES_PORT=5433` para `docker compose` y `DATABASE_URL=postgresql://practicas:practicas@localhost:5433/practicas?schema=public` para `pnpm`.

## Otras cosas que se vieron
- `decide` tiene la misma forma de "leer y después escribir" con el **estado** de la postulación (chequeo en las líneas 68-70, escritura en la 80): dos decisiones simultáneas sobre la misma postulación pueden pisarse. Se evalúa junto con E2-02.
- Un test con mocks no podría demostrar nada de esto: la carrera ocurre entre dos conexiones a la base.
