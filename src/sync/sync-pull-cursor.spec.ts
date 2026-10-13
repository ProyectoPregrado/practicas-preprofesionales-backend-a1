import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { encodeCheckpoint } from './checkpoint'
import { SyncService } from './sync.service'

// S-2: el cursor (updatedAt, id) tiene que aplicarse también a `placements`.
// Antes el `OR` de pertenencia pisaba al `OR` del cursor y la plaza volvía en cada pull.
describe('SyncService.pull — cursor en placements (S-2, Postgres real)', () => {
  const prisma = new PrismaService()
  const service = new SyncService(prisma)
  let placement: { id: number; studentId: number; tutorId: number; updatedAt: Date }

  beforeAll(async () => {
    await prisma.$connect()
    const found = await prisma.placement.findFirst({ orderBy: { id: 'asc' } })
    if (!found) throw new Error('S-2 necesita al menos una plaza en la base (pnpm db:seed)')
    placement = found
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const cursorAt = (updatedAt: Date, id: number) =>
    encodeCheckpoint({ updatedAt: updatedAt.toISOString(), id })

  it('no devuelve una plaza que el cursor ya cubre', async () => {
    const since = cursorAt(placement.updatedAt, placement.id)

    const result = await service.pull(placement.studentId, since, 100)

    expect(result.changes.placements.map((p) => p.id)).not.toContain(placement.id)
  })

  it('con el checkpoint al día no hay cambios ni más páginas aunque limit sea 1', async () => {
    const full = await service.pull(placement.studentId, undefined, 1000)

    const result = await service.pull(placement.studentId, full.checkpoint ?? undefined, 1)

    expect(result.changes.placements).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('devuelve la plaza si el cursor es anterior a su última modificación', async () => {
    const before = new Date(placement.updatedAt.getTime() - 1000)

    const result = await service.pull(placement.studentId, cursorAt(before, 0), 100)

    expect(result.changes.placements.map((p) => p.id)).toContain(placement.id)
  })

  it('sigue limitando por pertenencia: el tutor la ve y un tercero no', async () => {
    const before = new Date(placement.updatedAt.getTime() - 1000)
    const since = cursorAt(before, 0)
    const stranger = await prisma.user.findFirst({
      where: { id: { notIn: [placement.studentId, placement.tutorId] } },
    })

    const asTutor = await service.pull(placement.tutorId, since, 100)
    const asStranger = await service.pull(stranger!.id, since, 100)

    expect(asTutor.changes.placements.map((p) => p.id)).toContain(placement.id)
    expect(asStranger.changes.placements.map((p) => p.id)).not.toContain(placement.id)
  })
})
