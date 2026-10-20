import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { encodeCheckpoint } from './checkpoint'
import { SyncService } from './sync.service'

// S-2: el cursor (updatedAt, id) tiene que aplicarse también a `placements`.
// Antes el `OR` de pertenencia pisaba al `OR` del cursor y la plaza volvía en cada pull.
describe('SyncService.pull — cursor en placements (S-2, Postgres real)', () => {
  const prisma = new PrismaService()
  const service = new SyncService(prisma)
  const tag = `s2-${Date.now()}`
  let placement: { id: number; studentId: number; tutorId: number; updatedAt: Date }
  let strangerId: number
  const created: { users: number[]; companyId?: number; offerId?: number; applicationId?: number } = {
    users: [],
  }

  // Datos propios: el CI aplica las migraciones pero no el seed, así que no se puede
  // depender de filas preexistentes. Se borran al terminar.
  beforeAll(async () => {
    await prisma.$connect()
    const user = async (role: 'STUDENT' | 'TUTOR', name: string) => {
      const row = await prisma.user.create({
        data: { email: `${name}-${tag}@miyura.com`, password: randomUUID(), fullName: name, role },
      })
      created.users.push(row.id)
      return row
    }
    const student = await user('STUDENT', 'estudiante')
    const tutor = await user('TUTOR', 'tutor')
    strangerId = (await user('STUDENT', 'ajeno')).id
    const company = await prisma.company.create({
      data: { taxId: `TAX-${tag}`, name: `Empresa ${tag}`, sector: 'TI', contactEmail: `e-${tag}@miyura.com` },
    })
    const offer = await prisma.offer.create({
      data: {
        companyId: company.id,
        title: 'Oferta S-2',
        description: 'x',
        modality: 'Presencial',
        seats: 1,
        requiredHours: 240,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 86_400_000 * 60),
      },
    })
    const application = await prisma.application.create({
      data: { offerId: offer.id, studentId: student.id, motivation: 'Prueba S-2 del cursor de sync' },
    })
    placement = await prisma.placement.create({
      data: {
        applicationId: application.id,
        studentId: student.id,
        tutorId: tutor.id,
        companyId: company.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000 * 60),
        requiredHours: 240,
        status: 'ACTIVE',
      },
    })
    Object.assign(created, { companyId: company.id, offerId: offer.id, applicationId: application.id })
  })

  afterAll(async () => {
    await prisma.placement.deleteMany({ where: { id: placement?.id } })
    await prisma.application.deleteMany({ where: { id: created.applicationId } })
    await prisma.offer.deleteMany({ where: { id: created.offerId } })
    await prisma.company.deleteMany({ where: { id: created.companyId } })
    await prisma.user.deleteMany({ where: { id: { in: created.users } } })
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

    const asTutor = await service.pull(placement.tutorId, since, 100)
    const asStranger = await service.pull(strangerId, since, 100)

    expect(asTutor.changes.placements.map((p) => p.id)).toContain(placement.id)
    expect(asStranger.changes.placements.map((p) => p.id)).not.toContain(placement.id)
  })
})
