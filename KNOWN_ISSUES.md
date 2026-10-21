# Problemas conocidos

Lo que sabemos que está mal y no alcanzamos a arreglar. Está ordenado por lo que más nos
dolió, no por severidad técnica.

Si encuentras algo que no está acá, agrégalo. Casi seguro hay más.

Revisión K-1 (backend), 14 de octubre de 2026, actualizada con develop 8229dee.
E2-03, N-1, N-2, N-3, S-2 y D-11 ya están integradas en develop mediante los PR
#29, #30, #32, #28, #26 y #27, respectivamente. Los estados siguientes reflejan esa base.
D-02 queda pagada con E6-03 y el lint del backend (S-3b) queda en cero; ver más abajo.
Revisión de cierre del 21 de octubre de 2026 sobre develop con esta rama integrada.

--- Deuda Pagada

## N-2 — POST /applications valida la oferta y traduce las postulaciones repetidas

Integrada en develop mediante el PR #32. Antes, ApplicationService.apply creaba la
postulación sin validar nada: una oferta inexistente respondía 500, una postulación
repetida respondía 500 (HttpExceptionFilter solo captura HttpException, no el P2002 de
Prisma) y una oferta cerrada se aceptaba con 201. Ahora una oferta inexistente o no
publicada responde 404 y una postulación repetida responde 409. La unicidad
offerId/studentId la sigue dando la restricción de la base; el servicio solo traduce su
P2002. La regresión contra PostgreSQL, con dos postulaciones simultáneas del mismo
estudiante (una gana y la otra recibe 409), está en
`src/application/application-apply-e2e.spec.ts`.

Límite conocido: apply lee la oferta y después inserta, en dos pasos. Si la oferta se cierra
justo entre ambos, la postulación se crea igual; no afecta datos ni seguridad. Es el mismo
caso de publish y close (ver "Sin sprint"). El frontend muestra el mensaje del servidor al
postularse (OfferDetailPage), por lo que el 404 y el 409 llegan al usuario con texto claro.

--- Deuda Pagada

## N-3 — La plaza pasa a COMPLETED al alcanzar las horas requeridas

Integrada en develop mediante el PR #28. Al aprobar horas, una plaza ACTIVE pasa
a COMPLETED cuando la suma de horas aprobadas alcanza requiredHours. El bloqueo
por plaza protege las aprobaciones simultáneas y la transición incrementa version
una sola vez. Ver `src/hour-log/placement-completion.ts` y sus pruebas unitarias
y PostgreSQL en `placement-completion.spec.ts` y `placement-completion-e2e.spec.ts`.

--- Deuda Pagada

## S-2 — El cursor y la pertenencia de placements se combinan con AND

Integrada en develop mediante el PR #26. SyncService.pull combina con AND el OR
del cursor y el OR de pertenencia por studentId/tutorId; ninguno sobrescribe al
otro. La regresión contra PostgreSQL está en `src/sync/sync-pull-cursor.spec.ts`.

## F-1 — Falta verificar la explicación de los errores de permisos en la interfaz

Falta comprobar en la interfaz cómo se explican los 403/404 de ofertas ajenas,
borradores y tutor ajeno. Verificación de producto pendiente a cargo del frontend;
no se afirma haber observado un mensaje
incorrecto. Un estudiante con postulación a una oferta cerrada debe seguir viéndola.

--- Deuda Pagada

## N-5 — publish y close de ofertas ya no ganan dos veces

OfferService.publish y close leían el estado y después actualizaban en dos pasos. La
regresión `src/offer/offer-state-race-e2e.spec.ts` (Postgres real, barrera sin `sleep`)
demostró el fallo: dos llamadas simultáneas sobre la misma oferta terminaban las dos con
éxito, y en publish la segunda pisaba `publishedAt`. Ahora el UPDATE queda condicionado
al estado de origen (`updateMany`); quien pierde recibe el mismo 400 que si hubiera
llegado tarde. El test falla sin el arreglo (2 de 2 en rojo) y pasa con él.

Límite conocido: la lectura previa se conserva para el 404 y el 403; la garantía la da el
UPDATE condicionado. Lo mismo vale para `apply` frente a un `close` simultáneo (ver N-2).

--- Deuda Pagada

## D-01 · El sync duplica horas al reintentar

`src/offline/sync/push.ts` (front) y `src/sync/sync.service.ts` (back).

Si el push se corta a medias y el cliente reintenta, a veces aparecen dos registros de horas
idénticos. Pasa más en la práctica de campo, con señal intermitente. Mandamos un `clientOpId`
en cada operación y guardamos las operaciones en `sync_operations`, pero evidentemente algo
no está cerrando el círculo. No tuvimos tiempo de sentarnos a entenderlo.

Workaround actual: el coordinador borra los duplicados a mano.

--- Deuda Pagada (E6-03)

## D-02 · `HourLogService` se nos fue de las manos

`src/hour-log/hour-log.service.ts`

E6-03 extrae `HourLogReportService`, `HourLogExportService` y
`HourLogNotificationService`. `HourLogService` mantiene su contrato público y coordina las
escrituras; las reglas compartidas siguen en `hour-rules.ts`. Los bloqueos por estudiante
y plaza conservan sus transacciones. La notificación actual sigue siendo de consola.

Hay pruebas de caracterización del avance, resumen semanal y CSV, además de composición
de Nest y ausencia de notificación ante un commit fallido. Las pruebas PostgreSQL se
adaptaron al constructor y se ejecutaron con base real: 476 pruebas en verde al integrar.
Ver `docs/E6-03-responsabilidades.md`.

--- Deuda Pagada (S-3b)

## S-3b — Lint del backend

Bajó de 16 hallazgos (12 errores, 4 advertencias) a 0: `pnpm lint` termina con código 0 sin desactivar reglas. Las dos alertas de complejidad de acreditación desaparecieron con E5-02. Ver `docs/S-3b-lint-backend.md`.

--- Pruebas incorporadas; revisión E4 pendiente

## D-03 — Evaluaciones: pruebas incorporadas y revisión pendiente

src/evaluation/evaluation.service.spec.ts ya contiene 20 pruebas unitarias, ejecutadas
correctamente en las ramas de E2-03 y N-1. Por tanto, la afirmación "cero tests" está
desactualizada. Esa caracterización no demuestra que todas las reglas de rúbricas y
scores estén cubiertas: la revisión de E4-01 sigue pendiente.

--- Deuda Pagada

## D-04 — Listado de postulaciones sin N+1

E2-03 está integrada en develop mediante el PR #29. listByOffer carga los estudiantes
en lote y solo expone id, email y fullName. Con 200 candidatos, la regresión unitaria
pasa de 201 a 1 llamada ORM. La suite `src/application/application.postgres.spec.ts`
comprueba SQL y respuesta HTTP con 1, 20 y 250 candidatos, tras calentar la ruta,
y exige un máximo de 4 consultas. Las llamadas ORM no equivalen a consultas SQL;
ver `docs/E2-03-medicion.md` para el método de medición.

## D-05 · `calculateAccreditationStatus` da miedo tocarla

`src/placement/accreditation.ts`

ESLint la marca por complejidad. Son `if` anidados hasta seis niveles con toda la lógica de
acreditación adentro. Funciona — hasta donde sabemos — pero solo hay dos tests, así que
cualquier cambio es a ciegas. Si te toca modificar reglas de acreditación, escribe primero
tests de los casos que hoy funcionan.

--- Deuda Pagada

E5-01 fijó las reglas con 40 tests de caracterización (100 % de la función) y E5-02 la
reescribió como una lista de reglas ordenadas: la primera que aplica decide el nivel y las
razones, y el orden de la lista es la precedencia. Sin `if` anidados; ESLint pasa de 6
problemas (5 errores) a 0 en `accreditation.ts`. Se comprobó que el resultado es idéntico al
de la versión anterior en 294.000 combinaciones de entradas (incluidos `NaN`, negativos y
`null` en horas, pendientes y notas) y los tests de E5-01 no se modificaron. Los dos defectos que la
reescritura conservó a propósito se corrigieron aparte, con E5-01b: con `requiredHours = 0` el
porcentaje daba `NaN` o `Infinity` (la API lo serializa como `null` y la pantalla de acreditación
mostraba «null%»); ahora es 100 %, porque el requisito de horas está cumplido. Y el texto «hay 1
horas pendientes» ahora dice «hay 1 hora pendiente». El nivel de acreditación no cambió: si una
plaza puede exigir 0 horas es una decisión de producto.

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

--- Deuda Pagada

## N-1 — Exclusividad de plazas ACTIVE

Integrada en develop mediante el PR #30. Un índice único parcial impide dos plazas
ACTIVE para el mismo estudiante y activate devuelve 409 al perder la activación.
La regresión `src/placement/placement.postgres.spec.ts` cubre activaciones concurrentes
por HTTP y escrituras directas, así como una nueva activación tras completar la plaza
anterior. Ver `docs/N-1-plaza-activa.md` para el alcance del índice y la reproducción.

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

## D-12 · Una evaluación enviada dos veces se guarda dos veces, y no se sabe cuál cuenta

`src/evaluation/evaluation.service.ts`, `prisma/schema.prisma` (`Evaluation`) y
`src/placement/accreditation.service.ts`

`EvaluationService.submit` hace un `create` directo: `Evaluation` no tiene índice único ni hay
una consulta previa. La pantalla de evaluar (UX-6) impide el doble envío dentro de una pestaña
(el botón queda deshabilitado y el formulario se reemplaza), pero dos pestañas, o recargar y volver
a evaluar, dejan **dos evaluaciones** del mismo placement, tipo y periodo.

Después, `AccreditationService` elige con `placement.evaluations.find((e) => e.kind === kind)` sobre
un `include` sin `orderBy` y sin filtrar `deletedAt` (`listForPlacement` sí lo filtra). Con
duplicados, el código no define cuál puntaje cuenta para la acreditación.

Se afirma por lectura del código; no se reprodujo contra PostgreSQL ni hay una regresión escrita.
Decisión de producto pendiente: ¿cuenta la última evaluación, o se rechaza la segunda con 409 (como
`apply`, N-2)? Cualquiera de las dos necesita un test con dos envíos simultáneos.

## D-13 · Documentos: el archivo no se guarda y el tipo se puede repetir

`src/placement/placement.service.ts` (`addDocument`) y `src/pages/DocumentsPage.tsx` (frontend)

Dos cosas distintas:

- **El archivo no se sube.** El frontend manda nombre, tipo, tamaño y un `storageKey` aleatorio
  (`crypto.randomUUID()`); el backend guarda esos datos y nada más. Aun así, la plaza solo se
  activa con convenio y seguro en estado `VALIDATED`. Por eso el aviso del frontend (UX-9) dice
  «registrado» y no «subido»: no presentes esto como carga de archivos. La subida real está en la
  lista de lo que falta (documentos reales).
- **No hay unicidad por tipo.** `Document` no tiene índice único: subir dos veces el mismo tipo crea dos
  registros, y la pantalla del estudiante muestra el estado del más reciente por `updatedAt`. Un segundo
  envío simultáneo tampoco se rechaza.

Se afirma por lectura del código; no hay regresión escrita.

## UX-1 a UX-11 · Línea de confirmaciones y avisos (frontend)

Pantallas con confirmación o aviso propio (módulo `src/lib/notify.ts`, SweetAlert2 cargado bajo demanda):
aceptar, descartar y entrevista (UX-1, UX-2), aprobar horas y publicar o cerrar ofertas (UX-4), postularse
(UX-5), enviar evaluación (UX-6), registrar horas (UX-7), cerrar sesión con horas pendientes (UX-8) y
documentos (UX-9). UX-10 recarga la lista tras un 400 del servidor y UX-11 centraliza la traducción de
errores en `describeError`. UX-3 pasa los textos a tuteo y añade un test guardián en ambos repos.

Estado al 21 de octubre de 2026: los PR siguen abiertos (frontend #37, #38, #40 a #47 y #39; backend #44),
todos con CI en verde y sin conflictos; no están integrados en `develop`. Límites que quedan:

- **Casi nada se vio en un navegador real.** Los tests simulan `@/lib/notify`; en UX-1 el aviso de éxito
  tampoco se vio en el navegador (la oferta de prueba estaba llena). UX-5 a UX-11 no se probaron en la
  app, ni con dos pestañas ni sin conexión real.
- **El aviso de éxito de registrar horas y documentos no se espera** (UX-7, UX-9) para no dejar el botón
  bloqueado 3 s. Si el fragmento de SweetAlert2 no estuviera disponible sin conexión, su rechazo quedaría
  sin atender en consola; no afecta al guardado. El service worker lo precachea, pero no se verificó en frío.
- **El botón de confirmar ya no es rojo** al descartar horas al salir (UX-8): `notify.confirmar` usa el
  estilo principal. `LoginPage`, `ReviewHoursPage` (el diálogo de devolver) y `CompanyOffersPage` siguen
  con su `Dialog` propio.
- **La recarga de UX-10 se decide por código 400**, no por el texto: un 400 por otra causa recarga de más
  (inofensivo). Si la recarga de postulaciones falla, la pantalla pasa al estado de error.
- **`describeError` (UX-11) no cubre todo:** tres mensajes de carga y creación de `CompanyOffersPage` y el
  401 de `offline/sync/push.ts` conservan su propio manejo.
- **El guardián de tuteo (UX-3) usa una lista de formas conocidas:** no detecta un voseo que no esté en
  ella. Los comentarios del código con «acá» no se cambiaron. El mensaje de sesión expirada del backend
  no se vio en el navegador.
- Duplicados de evaluaciones y documentos: ver D-12 y D-13.

## E6-05 · La paginación del libro de horas está sin confirmar

Diez registros por página (`PAGE_SIZE = 10`, `src/components/Pagination.tsx`). Cambia lo que ve la
persona y es una decisión de producto que nadie ha confirmado. La medición del «antes» no es reproducible
(`docs/E6-05-medicion-libro-horas.md` del frontend).

## E6-02 · Un dispositivo adelantado respecto de Ecuador registra «hoy» como futuro

Un día «de hoy» desde un dispositivo con la hora adelantada se rechaza como fecha futura; en el sync ese
rechazo es definitivo. Está anotado en `CIERRE.md`. Opciones sin decidir: tolerar un margen o validar
contra la fecha del servidor.
