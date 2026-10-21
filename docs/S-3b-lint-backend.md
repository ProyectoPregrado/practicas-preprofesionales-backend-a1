# S-3b — Lint del backend

Responsable: Anthony. Cerrada al integrar la rama el 21 de octubre de 2026.

| Medición | Errores | Advertencias | Total |
|---|---:|---:|---:|
| Base `develop` antes de E5-02 (`5df1edf`) | 12 | 4 | 16 |
| `develop` con esta rama (E5-02 y E6-02 ya integradas) | 0 | 0 | 0 |

`pnpm lint` termina con código 0. No se desactivó ninguna regla ni se elevó ningún umbral.

## Qué corrigió esta rama

- E6-03 retira los comentarios de deuda del servicio que ya fue dividido.
- Los fixtures utilizan `randomUUID()` como valor de contraseña de prueba; el test de privacidad sigue comprobando que el valor exacto no aparezca en la respuesta.
- `SyncService` utiliza el tipo de Prisma del registro con su plaza, en lugar de `any`.
- La suite de integración de sync usa inferencia de tipos y propaga el error de setup con su causa: la falta de PostgreSQL ya no se convierte en una aparente ejecución correcta.

## Lo que resolvió E5-02

Los dos hallazgos de complejidad de `calculateAccreditationStatus` (ciclomática 17 y cognitiva 84) desaparecieron al reescribirla como lista de reglas (E5-02, Mauz). La asignación redundante de `level` que esta rama había quitado ya no existe en el código nuevo.

## Verificación

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm test
```

Queda decidir si se endurece el gate de lint de CI.
