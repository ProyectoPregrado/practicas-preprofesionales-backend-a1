# E2-03: listado de postulaciones sin N+1

Con 200 candidatos, listByOffer hacía una lectura de postulaciones y 200 lecturas
secuenciales de usuarios. Ahora carga la relación student en lote y selecciona
únicamente id, email y fullName. Conserva la respuesta y los permisos de E3-07.

## Medición antes y después

| Medición | Antes (b7c3bfa) | Después |
| --- | --- | --- |
| Llamadas ORM, 200 candidatos, coordinador (test unitario) | 201 | 1 |
| Consultas SQL y duración HTTP en PostgreSQL | Pendiente | CI previo al ajuste: 5 / 4 / 4 sentencias para 1 / 20 / 250 candidatos; detalle abajo |

Las llamadas ORM se midieron con mocks; **no son un conteo de SQL ni un benchmark
de latencia**. Prisma puede ejecutar más de una consulta para resolver una relación.
La prueba HTTP real registra SQL y milisegundos tras una petición de calentamiento para 1, 20 y 250 candidatos y exige
un máximo de 4 consultas, incluidas las dos lecturas de permisos de la empresa.
También comprueba la forma de la respuesta, la ausencia de datos privados, la lista
vacía, el acceso de coordinación y el 403 de una empresa ajena.

## Reproducir

Requiere PostgreSQL y permisos para crear esquemas en una base de pruebas.
Las pruebas migran un esquema aleatorio propio y solo eliminan ese esquema al terminar.
No limpian ni modifican las tablas existentes en public.

PowerShell, desde el repositorio:

~~~powershell
docker compose up -d postgres
$env:TEST_DATABASE_URL = 'postgresql://practicas:practicas@localhost:5432/practicas?schema=public'
node node_modules/vitest/vitest.mjs run src/application/application.postgres.spec.ts
~~~

Para medir el antes, ejecutar esa misma prueba sobre el commit b7c3bfa (la aserción
de consultas falla con el N+1 y deja la medición en consola); después ejecutar en
la cabeza de esta rama. En CI, DATABASE_URL ya está configurada y activa la prueba.
Sin TEST_DATABASE_URL ni DATABASE_URL, la suite PostgreSQL se omite explícitamente.

## Validación local y límites

La regresión unitaria fue RED antes del cambio: 200 lecturas de usuarios / 201
llamadas ORM. La ejecución PostgreSQL se intentó y falló porque localhost:5432 no
estaba disponible; Docker Desktop no expone un daemon en este entorno.
La medición real y la verificación HTTP siguen pendientes: no se presenta esta
historia como cerrada con solo mocks.

Rama Git Flow: feat/E2-03-lista-postulaciones, base develop local d75a630.
El pull de origin/develop falló por resolución DNS de github.com; hay que actualizar
la base y resolver cualquier cambio antes de publicar el PR contra develop.

Checks locales: typecheck y build correctos; lint de todos los archivos cambiados
sin errores. La suite sync-e2e existente requiere JWT_SECRET y PostgreSQL y queda
fuera de la ejecución unitaria sin base de datos.

## Ajuste de la medición del PR #29

El registro de CI compartido mostró 5 sentencias en la primera petición (1 candidato),
4 para 20 candidatos y 4 para 250. Los tiempos HTTP fueron 63,87 ms, 8,35 ms y 12,60 ms,
respectivamente. Son medidas anteriores a este ajuste; el registro no incluía el SQL
individual para identificar la sentencia adicional.

La prueba hace ahora una petición de calentamiento por tamaño, espera su respuesta
y luego reinicia el contador. Mide SQL y latencia con la ruta y el pool ya utilizados,
contando todas las sentencias de la petición medida. El límite sigue siendo 4 y se
comprueba además que el contador no esté vacío. Si se supera el límite, se registra
el SQL sin sus parámetros para facilitar el diagnóstico. Los casos de 20 y 250
candidatos siguen detectando una consulta por estudiante.

La rama incorpora develop local d7d4460. Sobre esa combinación pasaron 202 pruebas
unitarias y typecheck. La ejecución de esta medición ajustada contra PostgreSQL
queda pendiente del siguiente CI, porque Docker sigue sin un daemon local disponible.
