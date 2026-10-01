# E3-06 — Revisión de endpoints que devuelven usuarios

Barrido de toda consulta a `prisma.user` y de todo `include`/`select` que toca el modelo `User`
(campo sensible: `password`, hash de bcrypt). Objetivo: que ninguna respuesta HTTP devuelva ese
campo, y que cada consulta acote explícitamente qué trae en vez de confiar en que nadie lo
serialice después.

| Origen | Consulta | Campos que expone | Estado |
|---|---|---|---|
| `auth.service.ts:15` (`login`) | `user.findUnique({ where: { email } })` sin `select` | Ninguno hacia afuera: se usa `user.password` internamente para `bcrypt.compare` y la respuesta se arma a mano en `login()` con `{ id, email, fullName, role, companyId }`. | OK — ya estaba bien, se deja documentado para que nadie lo "simplifique" con un spread del objeto completo. |
| `application.service.ts:34` (`listByOffer`) | `user.findUnique({ select: { id, email, fullName } })` | `id`, `email`, `fullName` | OK — ya acotado. |
| `offer.service.ts:33` (`findAllForCompanyUser`) | `user.findUnique({ select: { companyId: true } })` | `companyId` (nunca sale de la función, solo filtra la query siguiente) | OK — ya acotado. |
| `placement.service.ts:71` (`findForStudent`) | `tutor: { select: { id, fullName, email } }` dentro del `include` de placement | `id`, `fullName`, `email` del tutor | OK — ya acotado, con comentario explícito en el código. |
| `accreditation.service.ts:17` (`reportForPeriod`) | `include: { student: true, ... }` | Traía el usuario completo (**password incluido**) a memoria; solo `fullName` llegaba al resultado final. | **Corregido en E3-06** → `student: { select: { fullName: true } }`. No llegaba a la respuesta HTTP antes tampoco (`calculateAccreditationStatus` solo lee `.fullName`), pero la consulta traía el hash a memoria sin necesidad — se cierra la puerta para cualquier refactor futuro que haga `...placement`. |
| `evaluation.service.ts:54` (`assertCompanyEvaluation`) | `user.findUnique({ where: { id } })` sin `select` | Traía el usuario completo; solo `.companyId` se usa y nunca se devuelve (método privado de validación). | **Corregido en E3-06** → `select: { companyId: true }`, mismo patrón que `offer.service.ts`. |

## Conclusión

Antes de esta revisión, **ninguna respuesta HTTP filtraba el password** — los dos puntos corregidos
traían el usuario completo a memoria pero nunca lo serializaban hacia el cliente. La corrección es
defensiva: cierra la posibilidad de que un cambio futuro (un `...student` o un `return evaluator`
agregado sin pensarlo) filtre el hash sin que nadie lo note en el PR.

**Regla para historias nuevas:** ninguna consulta a `prisma.user` (directa o vía relación de otro
modelo) se escribe sin `select` explícito. Si en algún momento se necesita el objeto completo,
eso mismo es una señal para pedir revisión aparte — no hay ningún caso legítimo hoy que necesite
serializar un `User` completo hacia un cliente.

## Cobertura de test

- `accreditation.service.spec.ts` — verifica que la consulta usa `select: { fullName: true }` para
  `student` (no `true`), y que el resultado de `reportForPeriod` nunca contiene la palabra
  `password` ni un hash simulado, aunque la fila devuelta por Prisma sí lo traiga.
- `evaluation.service.spec.ts` — verifica que `assertCompanyEvaluation` llama a
  `user.findUnique` con `select: { companyId: true }`.
