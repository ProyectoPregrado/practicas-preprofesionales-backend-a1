# E6-02: fechas de la práctica como día calendario

## Decisión

Una fecha de negocio es un **día calendario**, no un instante: `periodStart`, `periodEnd`,
`startDate`, `endDate` y la `date` de un registro de horas. Se guarda como medianoche UTC
(`'2026-03-01'` → `2026-03-01T00:00:00.000Z`) y toda comparación o agrupación se hace en UTC.
Nunca con los getters locales (`getDate`, `getMonth`, `getFullYear`) ni con
`new Date(año, mes, día)`, que dependen de la zona horaria del servidor.

Las marcas de tiempo (`createdAt`, `updatedAt`, `decidedAt`, `reviewedAt`, `expiresAt`) sí son
instantes y no cambian. Los helpers viven en `src/common/calendar-date.ts`.

## Criterios de aceptación

| Criterio | Dónde se cumple |
|---|---|
| Una fecha fuera del rango de la práctica se rechaza con un mensaje que dice el rango válido | `dateRangeError` en `hour-rules.ts`. Lo usan `POST /hour-logs` y el sync (crear y editar). Mensaje: «la fecha debe estar entre 2026-03-01 y 2026-07-31, los días de la práctica» |
| No se pueden registrar horas con fecha futura | `futureDateError` en `hour-rules.ts`, mismos tres caminos. «Hoy» es el día de la zona de la institución |
| La fecha se normaliza en el servidor a la zona horaria de la institución, configurable | `normalizeCalendarDay` en `calendar-date.ts`, aplicada en los DTO (`CreateHourLogDto.date`, `CreateOfferDto.periodStart/periodEnd`) y en el sync. Zona: `INSTITUTION_TIME_ZONE` (por defecto `America/Guayaquil`; una zona inválida falla con un mensaje claro) |
| Dispositivos en zonas horarias distintas producen el mismo resultado | Tests con el mismo instante enviado con offsets de UTC, Ecuador, Nueva Zelanda y Madrid, y con el servidor en tres zonas (`calendar-date.spec.ts`, `create-hour-log.dto.spec.ts`, `hour-log-date-e2e.spec.ts`) |

### Cómo se normaliza lo que manda un cliente
- `AAAA-MM-DD` ya es un día y se respeta tal cual, sin importar la zona del dispositivo.
- Un instante (con hora y offset) se lleva a la zona de la institución y se toma su día:
  `2026-03-02T22:00:00-05:00` es el 2 de marzo; antes se guardaba con hora y corría el día.
- Una fecha que no existe (`2026-02-31`; `Date` la corría al 3 de marzo) o cualquier otra cosa se
  rechaza con «la fecha no es válida (formato AAAA-MM-DD)».

### Suposiciones que conviene confirmar con la guía
El texto de los criterios salió de la revisión del PR; no se contrastó con la guía.
- El rango válido son los días de la práctica (`startDate` a `endDate` de la plaza), extremos incluidos.
- La zona de la institución por defecto es `America/Guayaquil`.
- «Mismo resultado desde dispositivos en zonas distintas» se interpretó como: el mismo instante, o
  la misma fecha `AAAA-MM-DD`, termina guardado como el mismo día.

## Qué estaba mal

- `AccreditationService.reportForPeriod` construía los límites del período con hora local. En un
  servidor en UTC-5, el período `2026-1` empezaba el 1 de enero a las 05:00 UTC, así que una plaza
  con `startDate = 2026-01-01` quedaba fuera de todos los períodos y una con `2026-07-01` entraba
  al primero en vez de al segundo.
- `HourLogService.weeklySummary` calculaba la semana ISO con getters locales: en UTC-5, el lunes
  `2026-03-02` caía en la semana `2026-W09` en vez de `2026-W10`.
- El servidor aceptaba cualquier fecha para un registro de horas: antes del inicio de la práctica,
  después de su fin o en el futuro (el frontend lo limitaba, pero no `curl` ni el sync). Una fecha
  con hora y offset se guardaba con hora y corría el día.

El CI corre en UTC, donde los dos primeros casos dan bien, por eso no se veían.

## Evidencia

- Tests con la zona forzada (UTC, `America/Guayaquil` y `Pacific/Auckland`): la suite completa pasa
  igual en las tres. Sin la corrección fallan 6 tests de zona y, sin conectar las reglas de fecha,
  otros 15.
- Con el servidor en `TZ=America/Guayaquil`: `GET /placements/accreditation` devolvía cada plaza de
  borde en el período equivocado; ahora en el suyo. `POST /hour-logs` aceptaba las siete fechas de
  prueba (incluida `2026-02-31`, guardada como el 3 de marzo, y un instante guardado con hora);
  ahora rechaza lo que debe y guarda el día normalizado. El sync aplica la misma regla.
- Rango y fecha futura contra Postgres real: `hour-log-date-e2e.spec.ts`.

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
- Los registros ya existentes no se revalidan: el rango y la fecha futura se exigen al crear y al
  editar, no a lo que ya está guardado.
- El seed y la demo: las plazas sembradas van de 2026-03-01 a 2026-07-31, así que una fecha de
  registro fuera de ese rango (por ejemplo, octubre de 2026) ahora se rechaza.
- Si E6-03 (Anthony) mueve `weeklySummary` a `hour-log-report.service.ts`, la llamada a
  `isoWeekLabel` de `calendar-date.ts` debe ir con ella.
