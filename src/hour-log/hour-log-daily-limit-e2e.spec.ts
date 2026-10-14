import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ApplicationStatus, OfferStatus, PlacementStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HourLogService } from './hour-log.service'

// E6-01 — El tope de 8 horas por día se cumple aunque los registros lleguen a la vez (Postgres real).
// Sin el bloqueo por estudiante, todos leen la misma suma y pasan: la misma ventana de E2-01.
const prisma = new PrismaClient()
const suffix = `${Date.now()}`
const service = new HourLogService(prisma as never)
const created = { userIds: [] as number[], placementId: 0, applicationId: 0, offerId: 0, companyId: 0 }
let studentId = 0
let placementId = 0

const dto = (hours: number, date: string) => ({
  placementId,
  date: new Date(date),
  startTime: '08:00',
  endTime: '10:00',
  hours,
  activity: 'Actividad de prueba',
})

const totalFor = async (date: string) => {
  const r = await prisma.hourLog.aggregate({ _sum: { hours: true }, where: { placementId, date: new Date(date) } })
  return r._sum.hours ?? 0
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `E601${suffix}`, name: `Empresa E6-01 ${suffix}`, sector: 'TI', contactEmail: `e601-${suffix}@test.local` },
  })
  created.companyId = company.id
  const offer = await prisma.offer.create({
    data: {
      companyId: company.id, title: `E6-01 ${suffix}`, description: 'x', modality: 'PRESENCIAL', seats: 1, requiredHours: 240,
      periodStart: new Date('2026-03-01'), periodEnd: new Date('2026-07-31'), status: OfferStatus.PUBLISHED,
    },
  })
  created.offerId = offer.id
  const [student, tutor] = await Promise.all(
    ['student', 'tutor'].map((kind) =>
      prisma.user.create({
        data: { email: `e601-${kind}-${suffix}@test.local`, password: randomUUID(), fullName: kind, role: kind === 'tutor' ? Role.TUTOR : Role.STUDENT },
      }),
    ),
  )
  created.userIds.push(student.id, tutor.id)
  studentId = student.id
  const application = await prisma.application.create({
    data: { offerId: offer.id, studentId, motivation: 'm'.repeat(24), status: ApplicationStatus.SUBMITTED },
  })
  created.applicationId = application.id
  const placement = await prisma.placement.create({
    data: {
      applicationId: application.id, studentId, tutorId: tutor.id, companyId: company.id, startDate: new Date('2026-03-01'),
      endDate: new Date('2026-07-31'), requiredHours: 240, status: PlacementStatus.ACTIVE,
    },
  })
  placementId = placement.id
  created.placementId = placement.id
})

afterAll(async () => {
  await prisma.hourLog.deleteMany({ where: { placementId } })
  await prisma.placement.delete({ where: { id: created.placementId } })
  await prisma.application.delete({ where: { id: created.applicationId } })
  await prisma.offer.delete({ where: { id: created.offerId } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  await prisma.company.delete({ where: { id: created.companyId } })
  await prisma.$disconnect()
})

describe('E6-01 — tope de 8 horas por día contra Postgres real', () => {
  it('cinco registros de 2 h lanzados a la vez para el mismo día dejan exactamente 8 h (cuatro pasan)', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.create(dto(2, '2026-04-06'), studentId)))

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4)
    expect(await totalFor('2026-04-06')).toBe(8)
  })

  it('el que se pasa recibe el mensaje claro del tope diario', async () => {
    await service.create(dto(8, '2026-04-07'), studentId)

    await expect(service.create(dto(0.5, '2026-04-07'), studentId)).rejects.toThrow(/no puede superar 8 horas/)
  })

  it('otro día no se ve afectado por un día completo', async () => {
    await expect(service.create(dto(8, '2026-04-08'), studentId)).resolves.toMatchObject({ hours: 8 })
  })
})
