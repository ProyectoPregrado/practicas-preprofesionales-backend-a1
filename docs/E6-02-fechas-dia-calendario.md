# E6-02: fechas de la práctica como día calendario

## Decisión

Una fecha de negocio es un **día calendario**, no un instante: `periodStart`, `periodEnd`,
`startDate`, `endDate` y la `date` de un registro de horas. Se guarda como medianoche UTC
(`'2026-03-01'` → `2026-03-01T00:00:00.000Z`) y toda comparación o agrupación se hace en UTC.
Nunca con los getters locales (`getDate`, `getMonth`, `getFullYear`) ni con
`new Date(año, mes, día)`, que dependen de la zona horaria del servidor.

Las marcas de tiempo (`createdAt`, `updatedAt`, `decidedAt`, `reviewedAt`, `expiresAt`) sí son
instantes y no cambian. Los helpers viven en `src/common/calendar-date.ts`.

## Qué estaba mal

- `AccreditationService.reportForPeriod` construía los límites del período con hora local. En un
  servidor en UTC-5, el período `2026-1` empezaba el 1 de enero a las 05:00 UTC, así que una plaza
  con `startDate = 2026-01-01` quedaba fuera de todos los períodos y una con `2026-07-01` entraba
  al primero en vez de al segundo.
- `HourLogService.weeklySummary` calculaba la semana ISO con getters locales: en UTC-5, el lunes
  `2026-03-02` caía en la semana `2026-W09` en vez de `2026-W10`.

El CI corre en UTC, donde ambos casos dan bien, por eso no se veía.

## Evidencia

- Tests con la zona forzada (UTC, `America/Guayaquil` y `Pacific/Auckland`) en
  `calendar-date.spec.ts`, `accreditation.service.spec.ts` y `hour-log.service.spec.ts`. Sin la
  corrección fallan 6 en las zonas distintas de UTC.
- Con el servidor corriendo en `TZ=America/Guayaquil` y dos plazas de borde (una que empieza el
  2026-01-01 y otra el 2026-07-01), `GET /placements/accreditation` devolvía cada una en el período
  equivocado o en ninguno; ahora cada una cae en el suyo.
- La suite completa pasa igual con `TZ=UTC`, `America/Guayaquil` y `Pacific/Auckland`.

## Migración de datos: no hace falta

Todas las fechas de negocio de la base ya están en medianoche UTC (0 filas con hora distinta de
200 plazas, 36 ofertas y 4000 registros). Antes de desplegar en otro entorno, comprobarlo:

~~~sql
SELECT 'placements.startDate' AS campo, COUNT(*) FROM placements WHERE "startDate" <> date_trunc('day', "startDate")
UNION ALL SELECT 'placements.endDate', COUNT(*) FROM placements WHERE "endDate" <> date_trunc('day', "endDate")
UNION ALL SELECT 'offers.periodStart', COUNT(*) FROM offers WHERE "periodStart" <> date_trunc('day', "periodStart")
UNION ALL SELECT 'offers.periodEnd', COUNT(*) FROM offers WHERE "periodEnd" <> date_trunc('day', "periodEnd")
UNION ALL SELECT 'hour_logs.date', COUNT(*) FROM hour_logs WHERE "date" <> date_trunc('day', "date");
~~~

Si alguna cuenta es distinta de cero, esas filas se normalizaron con otra zona y hay que decidir
caso por caso (la migración tendría que ser explícita y reversible).

## Límites conocidos

- `weeklySummary` no está expuesto por ninguna ruta HTTP hoy; su corrección se prueba con tests.
- Los DTO (`periodStart`, `periodEnd`, `date`) aceptan cualquier fecha ISO con `@Type(() => Date)`.
  El frontend envía `AAAA-MM-DD` (medianoche UTC), pero un cliente que mande una hora o un offset
  (`2026-03-02T22:00:00-05:00`) correría el día. Normalizar la entrada al día calendario queda
  como tarea aparte.
- Si E6-03 (Anthony) mueve `weeklySummary` a `hour-log-report.service.ts`, la llamada a
  `isoWeekLabel` de `calendar-date.ts` debe ir con ella.
