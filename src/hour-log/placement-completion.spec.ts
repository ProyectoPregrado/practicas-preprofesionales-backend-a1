import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completePlacementIfReached, withPlacementApprovalLock } from './placement-completion'

const tx = {
  $executeRaw: vi.fn(),
  hourLog: { aggregate: vi.fn() },
  placement: { findUnique: vi.fn(), updateMany: vi.fn() },
}

const sumIs = (hours: number | null) => tx.hourLog.aggregate.mockResolvedValue({ _sum: { hours } })
const placementIs = (requiredHours: number, status = 'ACTIVE') =>
  tx.placement.findUnique.mockResolvedValue({ requiredHours, status })

describe('N-3 — completePlacementIfReached', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.placement.updateMany.mockResolvedValue({ count: 1 })
  })

  it('completa la plaza ACTIVE cuando las horas aprobadas igualan requiredHours (borde exacto)', async () => {
    placementIs(240)
    sumIs(240)

    await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(true)
    expect(tx.placement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'ACTIVE' },
      data: { status: 'COMPLETED', version: { increment: 1 } },
    })
  })

  it('completa cuando las horas aprobadas superan requiredHours', async () => {
    placementIs(240)
    sumIs(244.5)

    await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(true)
  })

  it('no hace nada por debajo del umbral', async () => {
    placementIs(240)
    sumIs(239.5)

    await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(false)
    expect(tx.placement.updateMany).not.toHaveBeenCalled()
  })

  it('suma solo horas APPROVED no borradas de esa plaza', async () => {
    placementIs(10)
    sumIs(null)

    await completePlacementIfReached(tx as never, 1)

    expect(tx.hourLog.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { placementId: 1, status: 'APPROVED', deletedAt: null } }),
    )
    expect(tx.placement.updateMany).not.toHaveBeenCalled()
  })

  it.each(['PENDING_DOCS', 'SUSPENDED', 'ABANDONED', 'COMPLETED'])(
    'no toca una plaza %s aunque se alcance el umbral (idempotente)',
    async (status) => {
      placementIs(10, status)
      sumIs(50)

      await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(false)
      expect(tx.placement.updateMany).not.toHaveBeenCalled()
    },
  )

  it('devuelve false si el cierre condicionado no afectó filas', async () => {
    placementIs(10)
    sumIs(10)
    tx.placement.updateMany.mockResolvedValue({ count: 0 })

    await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(false)
  })

  it('devuelve false si la plaza no existe', async () => {
    tx.placement.findUnique.mockResolvedValue(null)

    await expect(completePlacementIfReached(tx as never, 1)).resolves.toBe(false)
  })
})

describe('N-3 — withPlacementApprovalLock', () => {
  it('toma el bloqueo antes de ejecutar el trabajo, dentro de la transacción', async () => {
    const order: string[] = []
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(txLock)),
    }
    const txLock = { $executeRaw: vi.fn(() => { order.push('lock'); return Promise.resolve(1) }) }

    await withPlacementApprovalLock(prisma as never, 5, async () => { order.push('work'); return 'ok' })

    expect(order).toEqual(['lock', 'work'])
  })
})
