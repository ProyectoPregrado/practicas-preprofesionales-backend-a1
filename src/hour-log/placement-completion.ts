import { HourLogStatus, PlacementStatus, type Prisma, type PrismaClient } from '@prisma/client'

// N-3: una plaza ACTIVE pasa a COMPLETED cuando las horas APPROVED (no borradas) alcanzan requiredHours.

// Espacio de claves propio para el bloqueo por plaza. `pg_advisory_xact_lock(int, int)` usa un espacio
// distinto al de `pg_advisory_xact_lock(bigint)` (el del tope diario por estudiante, hour-rules.ts), así
// que el id de una plaza nunca choca con el id de un estudiante.
const PLACEMENT_LOCK_NAMESPACE = 3001

// Serializa por plaza las aprobaciones de horas. Sin esto, dos aprobaciones simultáneas (READ COMMITTED)
// suman solo lo ya confirmado, no ven la del otro y ninguna cruza el umbral: la plaza nunca se completa.
// Se eligió el bloqueo advisory (y no SELECT ... FOR UPDATE) para no tocar la fila de la plaza en cada
// aprobación; solo se escribe cuando de verdad se completa. Se libera al terminar la transacción.
export function withPlacementApprovalLock<T>(
  prisma: PrismaClient,
  placementId: number,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLACEMENT_LOCK_NAMESPACE}::int, ${placementId}::int)`
    return work(tx)
  })
}

// Debe llamarse dentro de `withPlacementApprovalLock`, después de escribir la aprobación. Devuelve true
// solo si esta llamada movió la plaza a COMPLETED. El cierre está condicionado a `status: ACTIVE`, así
// que es idempotente y nunca pisa una plaza PENDING_DOCS/SUSPENDED/ABANDONED/COMPLETED.
export async function completePlacementIfReached(tx: Prisma.TransactionClient, placementId: number): Promise<boolean> {
  const placement = await tx.placement.findUnique({
    where: { id: placementId },
    select: { requiredHours: true, status: true },
  })
  if (!placement || placement.status !== PlacementStatus.ACTIVE) return false

  const approved = await tx.hourLog.aggregate({
    _sum: { hours: true },
    where: { placementId, status: HourLogStatus.APPROVED, deletedAt: null },
  })
  if ((approved._sum.hours ?? 0) < placement.requiredHours) return false

  // `version` sube porque la plaza es una entidad sincronizable hacia el cliente.
  const closed = await tx.placement.updateMany({
    where: { id: placementId, status: PlacementStatus.ACTIVE },
    data: { status: PlacementStatus.COMPLETED, version: { increment: 1 } },
  })
  return closed.count === 1
}
