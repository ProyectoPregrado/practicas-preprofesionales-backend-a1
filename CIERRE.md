# CIERRE — Yura (backend)

Cierre del Sprint 4, 21 de octubre de 2026. Cifras medidas sobre `develop` con todo integrado (backend `f055ed9`, frontend `bcdedaa`); salen de reportes reales y se pueden regenerar con `scripts/pitch-metrics.mjs` (resultado en `docs/pitch-cifras.json`).

| | Pruebas | Cobertura de líneas | Al inicio | Lint |
|---|---|---|---|---|
| Backend | 479 en 38 archivos (con PostgreSQL real) | 92,6 % | 33 % | sin hallazgos |
| Frontend | 244 en 42 archivos | 63,6 % | 16 % | sin hallazgos |

## Qué cerramos
- **E1 Sincronización offline:** sin pérdida ni duplicados, también con envíos concurrentes (E1-03b).
- **E3 Seguridad:** permisos por endpoint, un tutor o una empresa solo tocan lo suyo, sesión con expiración y refresh con rotación, `JWT_SECRET` obligatorio.
- **E2 Cupos y rendimiento:** el cupo, la plaza `ACTIVE` única y el cierre de plaza los garantiza la base de datos, cada uno con test de concurrencia contra Postgres real.
- **E6 Calidad del libro de horas:** una sola regla de horas en cada repo (E6-01), fechas como día calendario en la zona de la institución con rango y fecha futura validados (E6-02), `HourLogService` dividido (E6-03), formulario separado (E6-04), libro paginado (E6-05) y hooks con pruebas (E6-06).
- **E5 Acta de acreditación (parcial):** reglas fijadas con tests (E5-01), reescritas como lista de reglas legible (E5-02) y corregidos `requiredHours = 0` y el singular de las horas pendientes (E5-01b).
- Deuda paga en el proyecto: D-01, D-02, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11 y el lint de ambos repos (S-3, S-3b). D-03 queda parcial (ver abajo).

## Qué quedó en el backlog y por qué
| Pendiente | Por qué quedó |
|---|---|
| E4 rúbricas, E7 panel de seguimiento, E8 períodos | El backlog tiene 178 puntos y el equipo tenía ~107; el orden de ataque de la guía las deja al final |
| E5-03 (acta en PDF) y E5-04 (prácticas atascadas) | Dependían de E5-01 y E5-02, que cerraron en este sprint |
| Rediseño de la interfaz | Aplazado por decisión del equipo; hay un borrador de plan, sin responsables |
| Varias pestañas reales (T-1b) | Corregido con Web Locks y probado con dos copias del módulo; **nadie lo ha probado en un navegador real** (jsdom no tiene `navigator.locks`) |
| E6-05: paginación | Cambia lo que ve el usuario (10 por página); decisión de producto sin confirmar. La medición del «antes» no es reproducible |
| E6-01 en el frontend | El tope `8` es una constante (el backend lo lee de `MAX_HOURS_PER_DAY`) y los mensajes de error no son idénticos a los del backend |
| E6-02 y dispositivos adelantados | Un día «de hoy» desde un dispositivo adelantado respecto de Ecuador se rechaza como futuro; en el sync ese rechazo es definitivo |
| `apply` lee la oferta y luego inserta (N-2) | Una oferta que se cierra entre ambos pasos aún admite la postulación; no afecta datos ni seguridad |
| Plaza con 0 horas requeridas | El porcentaje ya es finito (100 %), pero el nivel no cambia; si puede existir es decisión de producto |
| Notificación al tutor | Es un mensaje de consola, no un correo |
| D-03 evaluaciones | El módulo tiene 20 pruebas, pero la revisión de E4-01 sigue pendiente |
| Ensayo cronometrado del pitch | El guion y las cifras están listos (`docs/pitch-demo-anthony.md`); falta un ensayo completo de cinco minutos |

## Qué le diríamos al siguiente equipo
1. **La base garantiza la exclusividad, no una lectura previa.** Si algo debe ser único o limitado: restricción, trigger o lock en la base, y la aplicación solo traduce el error.
2. **Una prueba que no pudo fallar no prueba nada.** Toda garantía de «solo uno gana» lleva un test concurrente contra Postgres real, con barrera determinista (sin `sleep`) y RED observado antes del arreglo.
3. **Pregunten al coordinador antes de elegir un límite.** El tope de horas (8 por día) es una decisión de producto, no técnica.
4. **Los tests de caracterización van antes de reescribir.** E5-02 se apoyó en los 40 tests de E5-01 y una comparación exhaustiva contra la versión anterior.
5. **Prueben en más de una zona horaria.** El CI corre en UTC y ahí los bugs de fechas no se ven; usen `src/test/time-zone.ts`.
6. **Revisen con la rama descargada, no solo con el diff.** Así aparecieron un `useMemo` tras un `return` que rompía la pantalla, criterios de aceptación sin cubrir y huecos que la mutación dejó vivos.
7. **No confíen en una marca de «pagada»** y mantengan `KNOWN_ISSUES.md` honesto: lo pagado sale, lo descubierto entra.

## Cómo levantarlo
`pnpm install` → `cp .env.example .env` → `docker compose up -d` → `pnpm db:deploy` → `pnpm db:seed` → `pnpm dev`. Pruebas: `pnpm test` (necesita Postgres arriba). Usuarios del seed: `coordinador@miyura.com`, `tutor0@` … `tutor7@`, `empresa0@` … `empresa11@`, `estudiante0@` … `estudiante199@` (dominio `miyura.com`, contraseña `yura1234`).
