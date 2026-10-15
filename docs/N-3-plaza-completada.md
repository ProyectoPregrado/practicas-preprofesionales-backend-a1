# N-3 — La plaza pasa a COMPLETED al alcanzar las horas requeridas

## Regla

Cuando el tutor **aprueba** un registro de horas, si la suma de horas `APPROVED` (no borradas) de la plaza es
`>= requiredHours` y la plaza está `ACTIVE`, la plaza pasa a `COMPLETED` y su `version` sube en 1 (es una
entidad sincronizable hacia el cliente). El borde exacto cuenta (aprobadas == requeridas completa).

- Solo `ACTIVE` -> `COMPLETED`. `PENDING_DOCS`, `SUSPENDED`, `ABANDONED` no cambian.
- Rechazar (`REJECTED`) nunca completa nada.
- Idempotente: el cierre es `updateMany` con `where: { id, status: ACTIVE }`; una plaza ya `COMPLETED` no se reescribe.
- Una plaza `COMPLETED` ya no acepta horas por `POST /hour-logs` (`create` exige `ACTIVE`; sin cambios, solo cubierto por test).

## Dónde vive

- `src/hour-log/placement-completion.ts`: `withPlacementApprovalLock` y `completePlacementIfReached`.
- `HourLogService.review` (`hour-log.service.ts`): la revisión y el posible cierre corren en una sola transacción.

## Concurrencia

Dos aprobaciones simultáneas de horas distintas de la misma plaza, en READ COMMITTED, suman cada una solo lo ya
confirmado: ninguna ve la aprobación de la otra y la plaza nunca se completa. Solución: la transacción toma
`pg_advisory_xact_lock(3001, placementId)` **antes** de escribir la aprobación y de sumar, de modo que la segunda
espera, y al desbloquearse ve (nueva instantánea por sentencia) lo que confirmó la primera.

Por qué advisory y no `SELECT ... FOR UPDATE` sobre la plaza: no escribe ni bloquea la fila de la plaza en cada
aprobación (otras lecturas/escrituras de la plaza no se frenan) y sigue el patrón ya usado en `hour-rules.ts`.
La forma de dos enteros usa un espacio de claves distinto al `pg_advisory_xact_lock(bigint)` del tope diario por
estudiante, así que un id de plaza nunca choca con un id de estudiante. El cierre condicionado a `ACTIVE` es la
segunda defensa.

## Pruebas

- Unitarios: `placement-completion.spec.ts` y bloque N-3 de `hour-log.service.spec.ts`.
- E2E contra Postgres real: `placement-completion-e2e.spec.ts` (umbral exacto, por debajo, rechazo, plaza no
  `ACTIVE`, concurrencia con 8 aprobaciones simultáneas, `create` sobre plaza `COMPLETED`, 0 residuos). Quitando
  el bloqueo, los tests de concurrencia fallan; con él pasan.

## Qué NO cubre

- Transiciones a `ABANDONED` o `SUSPENDED`, ni reabrir una plaza `COMPLETED`.
- Horas que lleguen por sincronización (offline) a una plaza ya `COMPLETED` o que cambien después de completarse:
  no hay lógica que revierta la plaza si una hora aprobada se borra o se corrige después.
- Otros caminos que aprueben horas (no existen hoy; si aparecen deben usar el mismo bloqueo).
- Notificación al estudiante/coordinador al completarse.
