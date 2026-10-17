# CIERRE — Yura (backend)

> Borrador del Sprint 4. Se completa al cierre con las cifras finales y lo que cada integrante aporte.

## Qué cerramos
- **E1 Sincronización offline:** sin pérdida ni duplicados, también con envíos concurrentes (E1-03b).
- **E3 Seguridad:** permisos por endpoint, un tutor o una empresa solo tocan lo suyo, sesión con expiración y refresh con rotación, `JWT_SECRET` obligatorio.
- **E2 Cupos y rendimiento:** el cupo, la plaza `ACTIVE` única y el cierre de plaza los garantiza la base de datos, cada uno con test de concurrencia contra Postgres real.
- **E6 Calidad del libro de horas:** _por completar al cierre del sprint (E6-02, E6-03 y lo que llegue)._
- **E5 Acta de acreditación:** E5-01 (reglas fijadas con tests, 100 % de la función); E5-02 _por completar_.

## Qué quedó en el backlog y por qué
| Pendiente | Por qué quedó |
|---|---|
| E4 rúbricas configurables, E7 panel de seguimiento, E8 períodos | El backlog tiene 178 puntos y el equipo tenía ~107; el orden de ataque de la guía las deja al final |
| E5-03 (acta en PDF) y E5-04 (avisos de prácticas atascadas) | Dependen de E5-01 y E5-02, que cerraron al final |
| Lint del backend (S-3b) | _Marcar según si entró en el sprint_ |
| Rama inalcanzable y `requiredHours = 0` en `calculateAccreditationStatus` | Hallazgos de E5-01; los tests los congelan y no se arreglaron (ver el PR) |
| Varias pestañas con rotación del refresh token | Riesgo conocido; sin coordinación entre pestañas |
| `apply` lee la oferta y luego inserta (N-2) | Una oferta que se cierra entre ambos pasos aún admite la postulación; no afecta datos ni seguridad |

## Qué le diríamos al siguiente equipo
1. **La base garantiza la exclusividad, no una lectura previa.** Si algo debe ser único o limitado: restricción, trigger o lock en la base, y la aplicación solo traduce el error.
2. **Una prueba que no pudo fallar no prueba nada.** Toda garantía de «solo uno gana» lleva un test concurrente contra Postgres real, con barrera determinista (sin `sleep`) y RED observado antes del arreglo.
3. **Pregunten al coordinador antes de elegir un límite.** El tope de horas (8 por día) es una decisión de producto, no técnica.
4. **Los tests de caracterización van antes de reescribir.** E5-02 se apoya en los 40 tests de E5-01; no los modifiquen.
5. **Lean `KNOWN_ISSUES.md` completo antes de tocar nada** y manténganlo honesto: lo pagado sale, lo descubierto entra.
6. **No confíen en una marca de «pagada».** En este proyecto hubo deudas marcadas como pagadas que no lo estaban (D-02) y al revés.

## Cómo levantarlo
`pnpm install` → `cp .env.example .env` → `docker compose up -d` → `pnpm db:deploy` → `pnpm db:seed` → `pnpm dev`. Pruebas: `pnpm test` (necesita Postgres arriba).
