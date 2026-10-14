# Problemas conocidos

Lo que sabemos que está mal y no alcanzamos a arreglar. Está ordenado por lo que más nos
dolió, no por severidad técnica.

Si encuentras algo que no está acá, agrégalo. Casi seguro hay más.

Revisión K-1 (backend), 14 de octubre de 2026, sobre develop local d75a630.
E2-03 y N-1 están implementadas en sus respectivas ramas; todavía no se integraron
a develop ni se validaron contra PostgreSQL. El pull falló por DNS, por lo que esta
revisión no afirma reflejar cambios más recientes del remoto.
D-02 sigue abierta: el servicio supera las 300 líneas y conserva las responsabilidades
y comentarios D-02. No se considera pagada por haber añadido tests o arreglado horas.
## N-2 — Postulaciones sin validar la oferta ni traducir duplicados

ApplicationService.apply crea la postulación directamente. No verifica que la oferta
exista o esté publicada. La unicidad offerId/studentId pertenece a la base, pero
HttpExceptionFilter solo captura HttpException: falta verificar por HTTP cómo se
expone el P2002. No se afirma haber reproducido un 500. Tarea N-2, pendiente.

## N-3 — Falta la transición prevista a COMPLETED

Los servicios solo escriben PENDING_DOCS y ACTIVE para las plazas. COMPLETED,
ABANDONED y SUSPENDED se leen para acreditación, pero no hay una transición que
complete la plaza al alcanzar las horas aprobadas requeridas. Tarea N-3, pendiente;
los otros cambios de estado no tienen sprint asignado.

## S-2 — El filtro de pertenencia sobrescribe el cursor de placements

En SyncService.pull, where contiene el OR del cursor. La consulta de plazas construye
{ ...where, OR: [{ studentId: userId }, { tutorId: userId }] }, por lo que reemplaza
ese OR. El hallazgo se confirma por lectura del objeto; falta reproducir sus efectos
contra PostgreSQL y corregirlo en S-2. No se cambia el sync desde esta tarea.

## F-1 — Falta verificar la explicación de los errores de permisos en la interfaz

Falta comprobar en la interfaz cómo se explican los 403/404 de ofertas ajenas,
borradores y tutor ajeno. Verificación de producto pendiente a cargo del frontend;
no se afirma haber observado un mensaje
incorrecto. Un estudiante con postulación a una oferta cerrada debe seguir viéndola.

## Sin sprint — Operaciones que todavía requieren caracterización

OfferService.publish y close leen el estado antes de actualizar; no hay atomicidad
entre ambas operaciones. ApplicationService.decide también lee y luego actualiza:
dos decisiones sobre una misma postulación pueden pisarse. El primero está verificado
por lectura; la carrera de decisiones requiere una prueba y se evalúa junto a E2-02.
No se declara demostrado el fallo de concurrencia con solo esa lectura.

--- Deuda Pagada
## D-01 · El sync duplica horas al reintentar

`src/offline/sync/push.ts` (front) y `src/sync/sync.service.ts` (back).

Si el push se corta a medias y el cliente reintenta, a veces aparecen dos registros de horas
idénticos. Pasa más en la práctica de campo, con señal intermitente. Mandamos un `clientOpId`
en cada operación y guardamos las operaciones en `sync_operations`, pero evidentemente algo
no está cerrando el círculo. No tuvimos tiempo de sentarnos a entenderlo.

Workaround actual: el coordinador borra los duplicados a mano.

--- Deuda pendiente

## D-02 · `HourLogService` se nos fue de las manos

`src/hour-log/hour-log.service.ts`

Empezó siendo el CRUD de horas y terminó haciendo validación, persistencia, notificación al
tutor y agregación de reportes. Pasa las 300 líneas. Cada vez que hay que tocar algo ahí, hay
que leerlo entero. Habría que partirlo por responsabilidad, pero nunca fue prioridad.
--- Pruebas incorporadas; revisión E4 pendiente

## D-03 — Evaluaciones: pruebas incorporadas y revisión pendiente

src/evaluation/evaluation.service.spec.ts ya contiene 20 pruebas unitarias, ejecutadas
correctamente en las ramas de E2-03 y N-1. Por tanto, la afirmación "cero tests" está
desactualizada. Esa caracterización no demuestra que todas las reglas de rúbricas y
scores estén cubiertas: la revisión de E4-01 sigue pendiente.

## D-04 — La lista de postulaciones va lenta

Corrección implementada en E2-03: listByOffer carga los estudiantes en lote y solo
expone id, email y fullName. Con 200 candidatos, el test unitario pasa de 201 a 1
llamada ORM. Medición SQL/HTTP en PostgreSQL pendiente por falta de servidor local;
ver docs/E2-03-medicion.md. No se da por pagada hasta completar esa validación.

## D-05 · `calculateAccreditationStatus` da miedo tocarla

`src/placement/accreditation.ts`

ESLint la marca por complejidad. Son `if` anidados hasta seis niveles con toda la lógica de
acreditación adentro. Funciona — hasta donde sabemos — pero solo hay dos tests, así que
cualquier cambio es a ciegas. Si te toca modificar reglas de acreditación, escribe primero
tests de los casos que hoy funcionan.

## D-06 · La validación de horas está en tres lados

`src/hour-log/dto/create-hour-log.dto.ts`, `src/hour-log/hour-log.service.ts` y el formulario
del frontend.

Y ya divergieron: el DTO acepta hasta 12 horas por registro y el servicio corta en 10. El
formulario tiene su propia versión. Nadie recuerda cuál es la correcta.

--- Deuda Pagada (backend)

La coordinación definió el tope: **8 horas por día**, sumando todos los registros del estudiante en
esa fecha, igual para todas las carreras y períodos. La regla vive ahora en un solo lugar,
`src/hour-log/hour-rules.ts` (configurable con `MAX_HOURS_PER_DAY`), y la usan el DTO, el servicio, la
exportación y el sync, con el mismo mensaje (E6-01). Falta el formulario del frontend, que sigue con
su propia copia.

## D-07 · `JWT_SECRET` tiene un fallback hardcodeado

`src/auth/auth.module.ts`

Si la variable de entorno no está, el módulo arranca igual con un secreto por defecto que
está en el código. Lo pusimos para no pelear con el entorno local y se quedó. En producción
esto no puede quedar así.

--- Deuda Pagada

`getRequiredJwtSecret()` (`src/auth/jwt-secret.ts`) lanza al cargar el módulo si falta la
variable — sin ella la aplicación no arranca, con un mensaje que dice cómo generarla. No
queda ningún valor por defecto en el código (E3-04).

## N-1 — Exclusividad de plazas ACTIVE

Corrección implementada: un índice único parcial impide dos plazas ACTIVE para el
mismo estudiante y activate devuelve 409 al perder la activación. Pruebas concurrentes
PostgreSQL/HTTP añadidas, todavía pendientes de ejecución por falta de servidor local.
No se da por cerrada; ver docs/N-1-plaza-activa.md.
## D-11 · El seed deja casi todas las ofertas con más aceptadas que cupos

`prisma/seed.ts`

El seed da a cada oferta entre 2 y 5 cupos (`seats: 2 + nextInt(4)`) y después reparte las 200
postulaciones `ACCEPTED` entre las 36 ofertas, unas 5 por oferta. Resultado: 36 de las 37 ofertas
nacen con más aceptadas que cupos. Pasa a ojos cerrados porque el seed inserta las postulaciones ya
aceptadas, sin pasar por `decide`.

Efecto práctico: ninguna de esas ofertas admite una aceptación nueva (el trigger de E2-02 la
rechaza, con razón), y el trigger **no** protege el `INSERT` justamente por este seed.

--- Deuda Pagada

El seed calcula primero cuántas aceptadas recibe cada oferta y fija `seats` = aceptadas + 0 a 2
libres, así que ninguna oferta nace sobrecupada (conteos y credenciales sin cambios). Con eso, la
migración `enforce_offer_seats_on_insert` extiende el trigger a `BEFORE INSERT OR UPDATE`: un
`INSERT` con `ACCEPTED` que supere los cupos falla con `offer_full`. Los datos ya sobrecupados en
bases existentes no se tocan (D-11).
