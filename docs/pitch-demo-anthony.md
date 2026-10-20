# Pitch de Yura — Guion de demo y cifras

Responsable: Anthony. Duración objetivo: **5 minutos**. Audiencia propuesta: unidad de
vinculación de una carrera; duración y audiencia definitivas por confirmar con el docente.

**Estado:** guion preparado y fuentes verificadas. El ensayo cronometrado en la aplicación
real queda pendiente: Docker está iniciado, pero el entorno de ejecución no tiene acceso
al motor (`permission denied`) ni al puerto de PostgreSQL (`EACCES`).
Los resultados esperados de la demo no se presentan como resultados ya observados.

## Preparación antes de presentar

1. Usar una base exclusiva de demo, vacía y migrada. Ejecutar `pnpm db:seed` una sola vez.
   El seed usa `create`: no es idempotente y no debe relanzarse sobre una base con datos.
2. Iniciar API y frontend siguiendo sus README. Mantener API disponible durante todo el
   recorrido; el corte de red afecta únicamente al navegador del estudiante.
3. Abrir cuatro perfiles de navegador independientes, una sesión por rol. Evitar varias
   pestañas que compartan la sesión mientras T-1b siga pendiente. Aceptar el aviso de
   almacenamiento local al entrar como estudiante y esperar la sincronización inicial.
4. Preparar las cuentas siguientes. La contraseña pública del seed es `yura1234`,
   exclusivamente para el entorno de demostración.

| Rol | Cuenta | Pantalla inicial |
|---|---|---|
| Estudiante | `estudiante0@miyura.com` | `/horas` |
| Tutor asignado | `tutor0@miyura.com` | `/practicantes` |
| Empresa de la plaza | `empresa0@miyura.com` | `/ofertas-empresa` |
| Coordinación | `coordinador@miyura.com` | `/acreditacion`, período `2026-1` |

5. Ejecutar el prechequeo de solo lectura sobre la base de demo:

```bash
node scripts/pitch-demo-check.mjs 2026-04-30
```

El comando verifica los roles, la asociación estudiante/tutor/empresa, la plaza activa
y que la fecha esté libre y dentro de la práctica. Imprime su `placementId`, las horas
aprobadas iniciales y los conteos reales. Si falla, resolver la preparación antes del
ensayo; no editar la base ni IndexedDB durante la presentación. En ensayos posteriores,
elegir otra fecha libre del período y un texto de actividad distinto.

6. Preparar DevTools → Network en el perfil del estudiante para activar/desactivar
   Offline. El caso central registra horas con la página ya cargada; no prometer que
   un primer inicio de sesión funciona sin conexión. Si se desea demostrar recarga
   offline, verificar antes una build de producción con su service worker instalado.

## Guion de cinco minutos

| Tiempo | Acción en la aplicación | Qué decir | Comprobación visible |
|---|---|---|---|
| 0:00–0:30 | Mostrar el libro de horas del estudiante y su avance inicial. | «Yura reúne el registro de prácticas y su revisión. El estudiante puede guardar su trabajo cuando no tiene señal.» | Plaza cargada, registros y horas aprobadas visibles. |
| 0:30–1:25 | Activar Offline solo en ese navegador. Pulsar **Registrar horas**. Fecha `2026-04-30`, 08:00–10:00, 2 horas, actividad `Demo Yura: registro de campo sin conexión`. Guardar. | «Este registro se guarda en el dispositivo y queda pendiente de enviar. Todavía no son horas aprobadas.» | El total de registros aumenta en uno y existe la actividad recién guardada. |
| 1:25–2:10 | Restablecer Online y usar **Sincronizar ahora**. Esperar el fin del ciclo; repetir ese botón una vez. | «Al volver la señal se envía la operación pendiente. Reintentar esa misma operación no crea otra copia.» | La cola queda vacía y permanece un único registro de esa actividad. No volver a pulsar Guardar: eso crearía una operación distinta. |
| 2:10–3:05 | Cambiar al perfil tutor, sincronizar, entrar en las horas del Estudiante 0 y pulsar **Aprobar** en la actividad de demo. Volver al estudiante y sincronizar. | «El tutor asignado revisa las horas. El avance se calcula con lo aprobado, no con lo que acaba de enviarse.» | Estado aprobado y aumento de 2 horas sobre la cifra inicial. La plaza sigue activa: esta demo no completa las 240 horas. |
| 3:05–3:40 | Cambiar al perfil empresa, abrir una de sus ofertas y su lista de postulaciones. | «La empresa consulta sus ofertas y candidaturas. Los cupos cuentan con protección en la base de datos; la evidencia concurrente está en las pruebas del repositorio.» | Lista de postulaciones de una oferta propia. No anunciar una aceptación nueva: las postulaciones del seed ya están aceptadas. |
| 3:40–4:20 | Cambiar a coordinación y actualizar el acta `2026-1`. Mostrar el Estudiante 0. | «Coordinación consulta el avance y los motivos que impiden acreditar. Tener registros no significa que la práctica ya esté acreditada.» | La fila conserva sus requisitos y refleja las horas aprobadas. |
| 4:20–5:00 | Mostrar las cifras verificadas y los límites; proponer el piloto. | «Proponemos un piloto con una cohorte real. Tenemos evidencia automatizada de reglas, permisos y sincronización; todavía debemos cerrar la deuda indicada y completar el ensayo en el entorno final.» | Cifras de esta revisión, sin afirmar ahorro de tiempo, usuarios reales ni rendimiento no medido. |

Si una operación sigue pendiente, mostrar ese estado y su mensaje. No editar tokens,
registros ni almacenamiento desde la consola para completar el recorrido. Anotar el fallo,
resolverlo después y repetir el ensayo completo antes de declararlo aprobado.

## Cifras y alcance de la evidencia

Base backend `5df1edf`; base frontend `4feb779`. Los cambios locales del backend se
identifican también con un hash de fuentes en `pitch-cifras.json`, generado a partir
de reportes JSON reales. No reutilizar los antiguos «288 backend / 144 frontend».

| Dato | Valor comprobado o esperado | Fuente y límite |
|---|---|---|
| Backend, suite sin PostgreSQL | 246 pruebas aprobadas en 24 archivos | Ejecución local. Excluye explícitamente las suites que requieren PostgreSQL; no es el total de CI. |
| Frontend | 180 pruebas aprobadas en 36 archivos | Ejecución completa de Vitest sobre el `develop` actualizado. No equivale a un ensayo de navegador. |
| Lint backend | 16 → 2 hallazgos; quedan 1 error y 1 advertencia | Reporte ESLint. Complejidad de acreditación pendiente de E5-02; lint global aún falla. |
| Typecheck y build backend | Correctos | `tsc --noEmit` y `tsc -p tsconfig.build.json`. |
| Seed de demostración | 200 estudiantes, 200 plazas y 4.000 registros de horas | Valores que crea `prisma/seed.ts` en una base nueva: 200 × 20. Son datos sintéticos, no clientes reales ni una medición de carga. Confirmar conteos con el prechequeo. |
| Estado inicial del Estudiante 0 | 60 horas aprobadas, 20 pendientes, 240 requeridas | Derivado del seed: 15 registros aprobados de 4 horas y 5 enviados de 4. Confirmar en la base de demo. |
| Tope diario backend | 8 horas por defecto | `hour-rules.ts`, configurable mediante `MAX_HOURS_PER_DAY`. El frontend todavía debe completar E6-01. |

### Evidencia por afirmación del producto

| Afirmación permitida | Evidencia del repositorio |
|---|---|
| Se guardan las horas y la operación pendiente juntas en el dispositivo | Front: `HourLogForm.tsx`, `HourLogForm.spec.tsx`, transacción Dexie con `hourLogs` y `outbox`. |
| El reintento de una operación de sync tiene deduplicación | Back: `sync.service.spec.ts`, con reintento secuencial y envíos concurrentes mediante dobles de Prisma. Front: `offline/sync/push.spec.ts`. Estas pruebas no demuestran por sí solas la carrera contra PostgreSQL real. |
| Solo el tutor asignado revisa esas horas | Back: `hour-log.service.spec.ts`; front: `ReviewHoursPage.spec.tsx` y control de rutas de `App.tsx`. |
| Cupos y plaza activa única tienen restricciones de base | Migraciones de cupos y plaza activa; `application-seats-e2e.spec.ts`, `application-decide-race-e2e.spec.ts`, `placement.postgres.spec.ts`. Su presencia no sustituye ejecutarlas en el cierre. |
| La sesión tiene caducidad y renovación | `auth.service.spec.ts`, `refresh-token.spec.ts`, `token-config.spec.ts`; front: `api/client.spec.ts`, `AuthContext.spec.tsx`. |

## Reproducir las cifras

Desde el backend, generar reportes en una carpeta temporal. Estos comandos de PowerShell
no alteran datos de negocio; el primer conjunto excluye explícitamente PostgreSQL:

```powershell
$reports = Join-Path ([System.IO.Path]::GetTempPath()) 'yura-pitch'
New-Item -ItemType Directory -Force $reports | Out-Null
$env:JWT_SECRET = 'pitch-local-tests-only'
pnpm exec vitest run --exclude '**/*-e2e.spec.ts' --exclude '**/*.postgres.spec.ts' --exclude '**/sync-pull-cursor.spec.ts' --reporter=json --outputFile="$reports/backend.json"
pnpm exec eslint . -f json -o "$reports/eslint.json"
Push-Location ../practicas-preprofesionales-frontend-a1
pnpm exec vitest run --reporter=json --outputFile="$reports/frontend.json"
Pop-Location
$env:GIT_EXECUTABLE = (Get-Command git).Source
node scripts/pitch-metrics.mjs "$reports/backend.json" "$reports/frontend.json" "$reports/eslint.json" docs/pitch-cifras.json
```

No cambiar fuentes entre ejecutar las suites y generar el resumen. El script conserva
el inicio de la corrida, aprobados/fallidos/pendientes, cantidad de archivos y hashes
de los reportes. No suma los tests del frontend con los del backend para simular
una única cobertura de integración.

Para el cierre con PostgreSQL disponible, usar una base de pruebas dedicada y migrada,
ejecutar `pnpm test:cov` en ambos repos y guardar esos nuevos resultados por separado.
Solo esa ejecución permite actualizar las afirmaciones sobre integración contra la base.

## Límites y respuestas breves

- **¿Funciona toda la aplicación sin internet?** El registro local de horas sí, después
  de autenticar y cargar la práctica. Decisiones, revisión y acreditación requieren servidor.
- **¿Se pierden los datos si cierro sesión con pendientes?** Hay un aviso; no cerrar ni
  descartar pendientes durante la demo. El almacenamiento pertenece a ese dispositivo.
- **¿Ya están probadas varias pestañas y toda la seguridad?** Existen pruebas específicas;
  la rotación de refresh entre pestañas sigue siendo T-1b. No afirmar seguridad absoluta.
- **¿El tutor recibe un correo?** No. La notificación actual del backend es de consola.
- **¿Ahorra un porcentaje de tiempo o soporta miles de usuarios simultáneos?** No hay
  medición de campo ni de carga que permita prometerlo. El piloto debe obtenerla.
- **¿Qué queda?** Complejidad de acreditación, historias de frontend que falten integrar,
  fechas E6-02 y las deudas vigentes. El rediseño está aplazado según el plan.

## Registro del ensayo

| Fecha | Entorno y commits | Duración real | Offline → sync → aprobación | Cuatro roles | Incidencias | Resultado |
|---|---|---|---|---|---|---|
| Pendiente | Acceso a Docker/PostgreSQL denegado al entorno de ejecución | Sin medir | Sin ejecutar en navegador | Sin ejecutar | Habilitar acceso al entorno de demo | No aprobado todavía |

El guion queda listo para Mabe. El criterio final se cumple únicamente al registrar un
ensayo completo de cinco minutos sobre la aplicación real, sin correcciones manuales.
