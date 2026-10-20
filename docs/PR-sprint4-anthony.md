## Problema

`HourLogService` reúne escrituras, notificaciones, reportes y exportación CSV. Esta mezcla
complica modificar el libro de horas sin afectar los bloqueos de E6-01 y N-3.

## Cambios

- E6-03: extrae `HourLogReportService`, `HourLogExportService` y
  `HourLogNotificationService`, inyectados por Nest, conservando la API pública.
- Añade caracterización de reportes/CSV, prueba de composición de Nest y comprobación
  de que un commit fallido no notifica al tutor.
- S-3b: corrige 14 de 16 hallazgos de lint sin desactivar reglas. Quedan las dos alertas
  de complejidad de acreditación, asignadas a E5-02 y dependientes de E5-01 (#35).
- Prepara el guion de demo de cinco minutos, métricas reproducibles y un prechequeo
  de solo lectura para las cuentas y datos de demo. Actualiza `KNOWN_ISSUES.md`.

## ¿Qué pasa si esto se ejecuta dos veces al mismo tiempo?

La suma diaria y la creación permanecen dentro de `withStudentHoursLock`.
La revisión condicionada a `SUBMITTED` y el cierre de la plaza permanecen dentro de
`withPlacementApprovalLock`. La notificación se ejecuta después del commit.
No se añade idempotencia a `POST /hour-logs`: dos registros distintos válidos pueden
crearse si no superan el tope diario. La deduplicación por `clientOpId` pertenece al sync.

## Verificación

- 246 pruebas backend aprobadas en 24 archivos, excluyendo explícitamente PostgreSQL.
- 180 pruebas frontend aprobadas en 36 archivos sobre `develop` (`4feb779`).
- Typecheck y build backend correctos.
- Lint: 1 error y 1 advertencia, ambos en la complejidad existente de acreditación.
- Antes de extraer: 47 pruebas existentes de horas y 10 de caracterización en verde.
- Pendientes: pruebas con PostgreSQL real y ensayo cronometrado de la aplicación.
  El entorno local recibe `permission denied` de Docker y `EACCES` del puerto de la base.

El workflow de CI ya configura PostgreSQL 16, aplica migraciones y ejecuta toda la suite.
Verificar su ejecución antes de fusionar. No marcar S-3b ni el ensayo de pitch como
completos mientras persistan los pendientes anteriores.

## Alcance

No cambian rutas, DTOs, fórmulas de reportes, reglas de fechas ni reglas de acreditación.
La notificación sigue siendo de consola, sin prometer envío de correo.
