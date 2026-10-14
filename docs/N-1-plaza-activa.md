# N-1: una sola plaza ACTIVE por estudiante

Dos plazas PENDING_DOCS de un mismo estudiante podían pasar a ACTIVE: activate
comprobaba estado y documentos, pero no la exclusividad. La migración añade un
índice único parcial sobre placements.studentId WHERE status = 'ACTIVE'.
PostgreSQL decide qué escritura gana incluso si las dos peticiones llegan juntas
o si se escribe directamente, sin pasar por PlacementService.

La activación que pierde se convierte en HTTP 409 con el mensaje
"el estudiante ya tiene un placement activo". Solo se traduce el P2002 de esa
restricción; otros errores se propagan. La plaza perdedora queda PENDING_DOCS.
Se permiten varias plazas pendientes o históricas; salir de ACTIVE libera el cupo.
El índice cubre toda fila ACTIVE, incluso si tiene deletedAt, según la regla actual.

## Prueba y reproducción

El commit b779402 añade las regresiones antes de la corrección. Su prueba unitaria
fue RED: devolvía P2002 en lugar de ConflictException. **La reproducción concurrente
contra PostgreSQL todavía no se ejecutó**: se intentó y localhost:5432 no responde.
No se considera demostrada la garantía de base de datos mediante mocks.

La suite real usa Nest, Prisma y PostgreSQL, sin sustituir guardias ni consultas:

- Dos activaciones HTTP simultáneas, en ambos órdenes: un 200 y un 409.
- Una segunda activación secuencial: conflicto y estado pendiente conservado.
- Escrituras concurrentes directas: una gana y la otra falla con P2002.
- Una nueva activación tras pasar la anterior a COMPLETED.
- Activaciones simultáneas de estudiantes distintos, que sí pueden ganar ambas.

Para verificar el RED real, ejecutar la suite sobre b779402; para el GREEN,
ejecutarla sobre la cabeza de esta rama. Cada ejecución migra un esquema aislado
aleatorio y solo elimina ese esquema, sin tocar los datos existentes.

~~~powershell
docker compose up -d postgres
$env:TEST_DATABASE_URL = 'postgresql://practicas:practicas@localhost:5432/practicas?schema=public'
node node_modules/vitest/vitest.mjs run src/placement/placement.postgres.spec.ts
~~~

CI configura DATABASE_URL y ejecuta la suite. Sin ninguna URL, se omite
explícitamente. Una URL configurada que no responde hace fallar la suite.

## Migración y revisión

Antes de aplicar en un entorno con datos, revisar:

~~~sql
SELECT "studentId", COUNT(*) FROM "placements"
WHERE "status" = 'ACTIVE'
GROUP BY "studentId" HAVING COUNT(*) > 1;
~~~

Si ya hay duplicados, el índice falla y exige resolverlos según el negocio.
La migración no elimina ni cambia plazas arbitrariamente. La unicidad parcial
se documenta en schema.prisma; no se usa @@unique, que bloquearía también las plazas
inactivas. Aplicar con pnpm db:deploy en el entorno correspondiente.

Rama Git Flow: fix/N-1-una-plaza-activa-por-estudiante, desde develop local d75a630.
Comparte únicamente el helper de esquemas con E2-03; no depende de que esa historia
se integre. Antes de publicar el PR contra develop hay que actualizar la base;
github.com no resuelve en el entorno actual. PostgreSQL/HTTP sigue pendiente y
esta historia no se presenta como cerrada.

Checks locales: 113 pruebas unitarias correctas (se excluye la suite sync-e2e
existente que requiere PostgreSQL); 6 casos PostgreSQL omitidos sin URL. Typecheck,
build y lint de todos los archivos cambiados correctos. Las pruebas de error
solo verifican la traducción HTTP; la exclusividad requiere ejecutar la suite real.
