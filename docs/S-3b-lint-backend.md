# S-3b — Lint del backend

Responsable: Anthony. Medición del 19 de octubre de 2026 (Ecuador).

| Medición | Errores | Advertencias | Total |
|---|---:|---:|---:|
| Base `develop` (`5df1edf`) | 12 | 4 | 16 |
| Esta rama | 1 | 1 | 2 |

## Corregido

- E6-03 retira los comentarios de deuda del servicio que ya fue dividido.
- Los fixtures utilizan `randomUUID()` como valor de contraseña de prueba; el test
  de privacidad sigue comprobando que el valor exacto no aparezca en la respuesta.
- `SyncService` utiliza el tipo de Prisma del registro con su plaza, en lugar de `any`.
- La suite de integración de sync usa inferencia de tipos y propaga el error de setup
  con su causa. La falta de PostgreSQL ya no se convierte en una aparente ejecución correcta.
- En acreditación se elimina únicamente la asignación inicial redundante de `level`.
  Cada rama ya asigna su resultado. No se reescriben reglas, prioridades ni mensajes.

## Pendiente de E5-01 → E5-02

Quedan `complexity` (17, máximo 10) y `sonarjs/cognitive-complexity` (84, máximo 15)
en `src/placement/accreditation.ts`. **El lint global todavía termina con código 1.**

El plan asigna la reescritura de esa función a Mauz en E5-02 y exige integrar primero
E5-01. Al comprobar GitHub, el [PR #35](https://github.com/ProyectoPregrado/practicas-preprofesionales-backend-a1/pull/35)
seguía abierto y no fusionado. No se desactivan reglas ni se elevan sus umbrales para
ocultar esta deuda. S-3b queda parcialmente resuelta, con 14 de 16 hallazgos corregidos.

Cuando E5-02 se integre, actualizar esta rama con `develop` y ejecutar:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Solo entonces debe marcarse S-3b completa y endurecerse el gate de lint de CI si el
equipo decide hacerlo. La sincronización global de deudas y `CIERRE.md` sigue a cargo de Mabe.
