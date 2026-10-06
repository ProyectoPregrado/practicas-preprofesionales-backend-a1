# E3-01 — Auditoría de permisos por endpoint (backend)

Inventario de qué rol puede llamar a cada endpoint y sobre qué datos. Objetivo: saber cuántos
agujeros hay antes de taparlos de uno en uno. El hueco que buscamos no es "falta el guard de rol"
(todos los endpoints de negocio lo tienen) sino **"el guard mira el rol y nadie mira la
pertenencia"**: ser tutor no significa ser el tutor de *esa* práctica; ser empresa no significa
ser la dueña de *esa* oferta.

> **Estado de la verificación.** Los veredictos de la tabla salen de leer el código en `develop`
> (`74457e5`). Los hallazgos H-1 a H-6 de la sección 3 se comprobaron además contra el backend
> corriendo, con el seed completo, el 2026-10-05: los seis son explotables o exponen datos tal como
> se describe. Cada uno trae el comando y el resultado real. Las pruebas modifican datos; después se
> revirtieron las filas tocadas (ver "Limpieza" al final de la sección 3).

## 1. Cómo se decide el acceso hoy

- `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`): exige un token válido y deja el payload en
  `request.user` (`sub` = id del usuario, `role`). No mira nada más.
- `RolesGuard` (`src/auth/guards/roles.guard.ts`): compara `user.role` con `@Roles(...)`. **Si el
  handler no lleva `@Roles`, deja pasar a cualquier usuario autenticado** (`if (!required?.length) return true`).
- La pertenencia no la resuelve ningún guard: cada servicio la comprueba (o no) por su cuenta.
  Hay un único helper reutilizable, `HourLogService.assertPlacementAccess` (coordinador, estudiante
  dueño o tutor asignado), y solo lo usa el controlador de horas.
- `ValidationPipe` global con `whitelist: true` (`main.ts`): descarta campos que el DTO no declara,
  pero **no** impide que el DTO declare un campo sensible (ver `companyId` en `POST /offers`).

## 2. Inventario (27 endpoints)

Prefijo global: `/api`. "Pertenencia" = comprueba que el recurso sea del usuario que llama,
además de su rol.

| # | Método y ruta | Roles permitidos | ¿Comprueba pertenencia? | Cómo / dónde | Veredicto |
|---|---|---|---|---|---|
| 1 | `POST /auth/login` | público | n/a | Sin guards, es la puerta de entrada. | OK |
| 2 | `POST /auth/refresh` | público (refresh token) | n/a | El token de renovación identifica al usuario (`auth.service.ts:44`). | OK |
| 3 | `GET /companies` | cualquier autenticado | n/a (catálogo) | Sin `@Roles`. Devuelve `findMany()` completo: `taxId`, `contactEmail`, `verified`. | **Revisar** — H-6 |
| 4 | `POST /companies` | COORDINATOR | n/a | `@Roles(COORDINATOR)`. | OK |
| 5 | `GET /offers` | cualquier autenticado | n/a (catálogo) | Solo `PUBLISHED` (`offer.service.ts:14`). | OK |
| 6 | `GET /offers/me` | COMPANY | **Sí** | Filtra por el `companyId` del usuario del token (`offer.service.ts:32`). | OK |
| 7 | `GET /offers/:id` | cualquier autenticado | No | `findOne` no filtra por estado ni por dueña (`offer.service.ts:22`): devuelve ofertas `DRAFT` y `CLOSED` de cualquier empresa. | **No** — H-5 |
| 8 | `POST /offers` | COMPANY, COORDINATOR | **No** | `CreateOfferDto` trae `companyId` en el cuerpo y `create` lo usa tal cual (`offer.service.ts:10`). Una empresa crea ofertas a nombre de otra. | **No** — H-4 |
| 9 | `PATCH /offers/:id/publish` | COMPANY, COORDINATOR | **No** | `publish` busca la oferta por id y la publica; no compara `offer.companyId` con la del usuario (`offer.service.ts:42`). | **No** — H-4 |
| 10 | `PATCH /offers/:id/close` | COMPANY, COORDINATOR | **No** | Igual que el anterior (`offer.service.ts:54`). | **No** — H-4 |
| 11 | `POST /applications` | STUDENT | **Sí** | `studentId` sale del token (`req.user.sub`), no del cuerpo. | OK |
| 12 | `GET /offers/:offerId/applications` | COMPANY, COORDINATOR | **No** | `listByOffer(offerId)` no recibe al usuario (`application.service.ts:30`). Devuelve además `email` y `fullName` de los candidatos. | **No** — H-3 (E3-07) |
| 13 | `GET /applications/me` | STUDENT | **Sí** | `where: { studentId }` con el id del token. | OK |
| 14 | `PATCH /applications/:id/decide` | COMPANY, COORDINATOR | **No** | `decide(id, status)` no recibe al usuario (`application.service.ts:43`). | **No** — H-3 (E3-07) |
| 15 | `GET /placements/accreditation` | COORDINATOR | n/a | Rol exclusivo. | OK |
| 16 | `POST /placements` | COORDINATOR | n/a | Rol exclusivo. | OK |
| 17 | `GET /placements/me` | STUDENT | **Sí** | `findForStudent(req.user.sub)`. | OK |
| 18 | `PATCH /placements/:id/activate` | COORDINATOR | n/a | Rol exclusivo. | OK |
| 19 | `POST /placements/:id/documents` | STUDENT, COORDINATOR | **Sí** | El estudiante solo sube a su plaza; la coordinación a cualquiera (`placement.service.ts:80`). | OK |
| 20 | `POST /hour-logs` | STUDENT | **Sí** | `placement.studentId !== studentId` rechaza (`hour-log.service.ts:33`). Responde 400, no 403: es un detalle de código HTTP, no un hueco. | OK |
| 21 | `GET /placements/:id/hour-logs` | cualquier autenticado | **Sí** | `assertPlacementAccess`: coordinador, estudiante dueño o tutor asignado. | OK |
| 22 | `GET /placements/:id/progress` | cualquier autenticado | **Sí** | Igual que el anterior. | OK |
| 23 | `PATCH /hour-logs/:id/review` | TUTOR | **No** | `review` busca la hora por id y la aprueba o rechaza; nunca compara `placement.tutorId` con el tutor del token (`hour-log.service.ts:95`). | **No** — H-1 (E3-02) |
| 24 | `POST /evaluations` | TUTOR, COMPANY, STUDENT | **Sí** | `assertCanSubmit`: tutor asignado, empresa de la plaza o estudiante dueño, según el `kind`. | OK |
| 25 | `GET /placements/:id/evaluations` | cualquier autenticado | **Sí** | Coordinador, estudiante dueño o tutor asignado (`evaluation.service.ts:74`). | OK |
| 26 | `GET /sync/pull` | cualquier autenticado | **Sí** | Todo se filtra por `studentId`/`tutorId` = usuario del token (`sync.service.ts:25`). | OK |
| 27 | `POST /sync/push` | cualquier autenticado | **Sí** | `create` y `update`/`delete` exigen `placement.studentId === userId` (`sync.service.ts:101,74`). | OK |

**Resumen:** 27 endpoints, 7 sin comprobar pertenencia (#7, #8, #9, #10, #12, #14, #23) más
1 a revisar por exposición de datos (#3). Esos 8 endpoints se agrupan en 5 hallazgos: H-1
(#23), H-3 (#12 y #14), H-4 (#8, #9 y #10), H-5 (#7) y H-6 (#3). De ellos, **H-4 y H-5 no están cubiertos por ninguna historia del backlog** (E3-02 cubre H-1
y E3-07 cubre H-3).

## 3. Hallazgos con su prueba

Preparación común. Con el seed limpio (`pnpm db:seed`) los ids son predecibles: `estudiante i` →
plaza `i+1`, con tutor `tutor(i % 8)`; `empresa i` → `companyId = i+1` y dueña de las ofertas
`3i+1` a `3i+3`; cada plaza tiene 20 horas y de la 16 a la 20 están `SUBMITTED`. Comandos en Git
Bash; en PowerShell usa `curl.exe` (el alias `curl` es otra cosa).

```bash
BASE=http://localhost:3000/api
login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@miyura.com\",\"password\":\"yura1234\"}" \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}
```

### H-1 — Un tutor aprueba horas de una plaza que no es suya (→ E3-02) · Prioridad alta

`tutor0` no es tutor de la plaza 2 (la de `estudiante1`, tutor `tutor1`). La hora 36 es de esa plaza
y está `SUBMITTED`.

```bash
T0=$(login tutor0)
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $BASE/hour-logs/36/review \
  -H "Authorization: Bearer $T0" -H 'Content-Type: application/json' \
  -d '{"status":"APPROVED","note":"prueba E3-01"}'
```

Esperado si es explotable: `200`. Esperado si estuviera cerrado: `403`.

**Verificado: explotable.** `HTTP 200`; en la base la hora 36 pasó de `SUBMITTED` a `APPROVED` con
`reviewedById = 2` (`tutor0`, que no es el tutor de esa plaza). Control: el mismo `curl` con un
estudiante responde `403 "rol insuficiente"`, así que el guard de rol funciona; lo que falta es la
pertenencia.

### H-3 — Una empresa ve y decide postulaciones de ofertas ajenas (→ E3-07) · Prioridad alta

`empresa0` es dueña de las ofertas 1 a 3. La oferta 4 es de `empresa1`.

```bash
E0=$(login empresa0)
# Ver candidatos de una oferta ajena (incluye email y nombre de los estudiantes)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/offers/4/applications -H "Authorization: Bearer $E0"
```

Para `decide` hace falta una postulación aún `SUBMITTED` (las del seed ya están `ACCEPTED`):

```bash
S0=$(login estudiante0)
APP=$(curl -s -X POST $BASE/applications -H "Authorization: Bearer $S0" \
  -H 'Content-Type: application/json' -d '{"offerId":4,"motivation":"prueba de la auditoria E3-01"}' \
  | sed -E 's/.*"id":([0-9]+).*/\1/')
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $BASE/applications/$APP/decide \
  -H "Authorization: Bearer $E0" -H 'Content-Type: application/json' -d '{"status":"REJECTED"}'
```

(`motivation` exige al menos 20 caracteres; con menos, el `POST /applications` responde 400 y `$APP`
queda vacío.)

Esperado si es explotable: `200` en ambos. Esperado si estuviera cerrado: `403`.

**Verificado: explotable.**
- Listar: `HTTP 200` con 6 candidatos de la oferta 4 (de `empresa1`), cada uno con `email` y
  `fullName` del estudiante.
- Decidir: `HTTP 200`; la postulación creada (id 201) pasó de `SUBMITTED` a `REJECTED` decidida por
  `empresa0`, que es dueña de las ofertas 1 a 3.

### H-4 — Una empresa crea, publica y cierra ofertas de otra · Prioridad alta · issue #13 (sin asignar)

```bash
E0=$(login empresa0)
# Crear una oferta a nombre de la empresa 2 (empresa1) siendo empresa0
OFFER=$(curl -s -X POST $BASE/offers -H "Authorization: Bearer $E0" -H 'Content-Type: application/json' \
  -d '{"companyId":2,"title":"oferta E3-01","description":"x","modality":"PRESENCIAL","seats":1,"requiredHours":240,"periodStart":"2026-03-01","periodEnd":"2026-07-31"}' \
  | sed -E 's/.*"id":([0-9]+).*/\1/')
# empresa0 publica una oferta que ahora es de empresa1, y cierra una publicada de empresa1
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $BASE/offers/$OFFER/publish -H "Authorization: Bearer $E0"
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $BASE/offers/4/close        -H "Authorization: Bearer $E0"
```

Esperado si es explotable: `201`, `200`, `200`. Esperado si estuviera cerrado: `403`.
Ojo: el último `curl` cierra la oferta 4 del seed; para restaurarla basta
`update offers set status='PUBLISHED' where id=4;` o volver a sembrar una base limpia.

**Verificado: explotable.** `HTTP 201`, `200` y `200`. En la base la oferta nueva quedó con
`companyId = 2` (`empresa1`) aunque la creó `empresa0` (`companyId = 1`); `empresa0` la publicó
(`DRAFT` → `PUBLISHED`) y cerró la oferta 4 de otra empresa (`PUBLISHED` → `CLOSED`).

### H-5 — Cualquier usuario autenticado lee ofertas `DRAFT` y `CLOSED` de otras empresas · Prioridad media · issue #14 (sin asignar)

Reutiliza la oferta creada en H-4 (sigue en `DRAFT` si no se publicó) o cualquier oferta cerrada.

```bash
S0=$(login estudiante0)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/offers/$OFFER -H "Authorization: Bearer $S0"
```

Esperado si es explotable: `200` (un estudiante ve un borrador de otra empresa). Esperado si estuviera
cerrado: `404` o `403`.

**Verificado: explotable.** `HTTP 200`: `estudiante0` leyó una oferta en `DRAFT` de `empresa1`.

### H-6 — `GET /companies` expone `taxId` y `contactEmail` a cualquier rol · Prioridad baja

Probablemente es intencional (los estudiantes ven la empresa de cada oferta), pero hoy entrega
campos que el catálogo no necesita.

```bash
S0=$(login estudiante0)
curl -s $BASE/companies -H "Authorization: Bearer $S0" | head -c 400
```

Esperado si expone datos: la respuesta incluye `taxId` y `contactEmail`.

**Verificado: expone datos.** `estudiante0` recibe de todas las empresas `taxId`, `contactEmail` y
`verified` (por ejemplo `"taxId":"1790000000001","contactEmail":"rrhh@empresa0.com"`). Decisión
pendiente del equipo: acotar con `select` o dejarlo documentado como aceptado.

### Limpieza

Para que las pruebas no dejen la base alterada se revirtieron las filas tocadas: la hora 36 volvió a
`SUBMITTED` (con `reviewedById`, `reviewedAt` y `reviewNote` vacíos y `version = 1`), la oferta 4 a
`PUBLISHED`, y se borraron solo las filas creadas por las pruebas (la oferta `oferta E3-01` y la
postulación con motivación `prueba de la auditoria E3-01`). Conteos finales: 4001 horas, 36
ofertas, 200 postulaciones.

## 4. Tareas hijas propuestas para la épica E3

| Hallazgo | Tarea | Historia existente | Prioridad |
|---|---|---|---|
| H-1 | Comprobar que el tutor de la hora sea el de la plaza | E3-02 (Anthony) | Alta |
| H-3 | Comprobar que la oferta sea de la empresa que llama, en listar y decidir | E3-07 (Mauz) | Alta |
| H-4 | Comprobar la pertenencia en crear, publicar y cerrar ofertas; no aceptar `companyId` del cuerpo a una empresa | Issue #13 (sin asignar) | Alta |
| H-5 | Acotar `GET /offers/:id` a ofertas publicadas o a la dueña | Issue #14 (sin asignar) | Media |
| H-6 | Acotar los campos de `GET /companies` | sin issue: queda como decisión del equipo | Baja |

H-4 se parece mucho a E3-07 (misma comprobación, mismo patrón `offer.companyId` contra
`user.companyId`) y podría ir en el mismo PR si se decide ampliar su alcance.

## 5. Observaciones fuera del alcance de E3-01

Se anotan para que no se pierdan; ninguna es un problema de pertenencia.

- **`GET /sync/pull` ignora el cursor al consultar `placements`.** En `sync.service.ts:29` se
  escribe `{ ...where, OR: [...] }`: cuando hay cursor, `where` ya trae un `OR` con el filtro de
  `updatedAt` e `id`, y el `OR` de pertenencia lo **reemplaza**. Resultado: con cursor, las plazas
  del usuario se devuelven siempre completas. No filtra datos ajenos (el `OR` de pertenencia sigue
  aplicando), pero repite trabajo en cada sincronización. Por verificar.
- **`POST /hour-logs` responde 400 cuando la plaza no es del estudiante** (`hour-log.service.ts:33`),
  no 403. Es cuestión de semántica HTTP.
- **`POST /applications` no comprueba que la oferta exista ni esté publicada.** Pertenece a la
  épica E2 (integridad de cupos), no a E3.

## 6. Cobertura del frontend

El criterio de E3-01 pide que el inventario cubra los dos repositorios. La parte del frontend
(rutas protegidas por rol y lo que el cliente da por hecho del servidor) está en el repositorio
frontend, en `docs/E3-01-auditoria-permisos-rutas.md`. Allí no hay `curl`: un cliente no impone
permisos, así que lo que se verifica es que el servidor no dependa de lo que la interfaz oculta.
