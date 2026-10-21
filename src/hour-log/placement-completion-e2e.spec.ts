import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ApplicationStatus, HourLogStatus, OfferStatus, PlacementStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HourLogService } from './hour-log.service'
import { HourLogNotificationService } from './hour-log-notification.service'
import { HourLogReportService } from './hour-log-report.service'
import { HourLogExportService } from './hour-log-export.service'

// N-3 — La plaza pasa a COMPLETED cuando las horas aprobadas alcanzan requiredHours (Postgres real).
// Sin el bloqueo por plaza, dos aprobaciones simultáneas no ven la del otro y ninguna cruza el umbral.
const prisma = new PrismaClient()
const suffix = `${Date.now()}`
const service = new HourLogService(
  prisma as never,
  new HourLogNotificationService(),
  new HourLogReportService(prisma as never),
  new HourLogExportService(prisma as never),
)
const REQUIRED = 8
const created = { userIds: [] as number[], placementIds: [] as number[], applicationIds: [] as number[], offerIds: [] as number[], companyId: 0 }
let tutorId = 0
let seq = 0

// Cada plaza usa su propio estudiante para respetar el índice de una sola plaza ACTIVE por estudiante (N-1).
const newPlacement = async (status: PlacementStatus = PlacementStatus.ACTIVE) => {
  seq += 1
  const student = await prisma.user.create({
    data: { email: `n3-student-${suffix}-${seq}@test.local`, password: randomUUID(), fullName: 'student', role: Role.STUDENT },
  })
  created.userIds.push(student.id)
  const studentId = student.id
  const offer = await prisma.offer.create({
    data: {
      companyId: created.companyId, title: `N-3 ${suffix}-${seq}`, description: 'x', modality: 'PRESENCIAL', seats: 1, requiredHours: REQUIRED,
      periodStart: new Date('2026-03-01'), periodEnd: new Date('2026-07-31'), status: OfferStatus.PUBLISHED,
    },
  })
  created.offerIds.push(offer.id)
  const application = await prisma.application.create({
    data: { offerId: offer.id, studentId, motivation: 'm'.repeat(24), status: ApplicationStatus.SUBMITTED },
  })
  created.applicationIds.push(application.id)
  const placement = await prisma.placement.create({
    data: {
      applicationId: application.id, studentId, tutorId, companyId: created.companyId, startDate: new Date('2026-03-01'),
      endDate: new Date('2026-07-31'), requiredHours: REQUIRED, status,
    },
  })
  created.placementIds.push(placement.id)
  return placement.id
}

// Un registro SUBMITTED de `hours` horas, en un día distinto cada vez.
const newLog = async (placementId: number, hours: number, status: HourLogStatus = HourLogStatus.SUBMITTED) => {
  seq += 1
  const log = await prisma.hourLog.create({
    data: { placementId, date: new Date(Date.UTC(2026, 3, seq)), startTime: '08:00', endTime: '12:00', hours, activity: 'Actividad de prueba', status },
  })
  return log.id
}

const placementOf = (id: number) => prisma.placement.findUniqueOrThrow({ where: { id } })

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `N3${suffix}`, name: `Empresa N-3 ${suffix}`, sector: 'TI', contactEmail: `n3-${suffix}@test.local` },
  })
  created.companyId = company.id
  const tutor = await prisma.user.create({
    data: { email: `n3-tutor-${suffix}@test.local`, password: randomUUID(), fullName: 'tutor', role: Role.TUTOR },
  })
  created.userIds.push(tutor.id)
  tutorId = tutor.id
})

afterAll(async () => {
  await prisma.hourLog.deleteMany({ where: { placementId: { in: created.placementIds } } })
  await prisma.placement.deleteMany({ where: { id: { in: created.placementIds } } })
  await prisma.application.deleteMany({ where: { id: { in: created.applicationIds } } })
  await prisma.offer.deleteMany({ where: { id: { in: created.offerIds } } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  await prisma.company.delete({ where: { id: created.companyId } })
  // 0 residuos: nada de lo creado por esta suite debe quedar en la base.
  const leftovers = await Promise.all([
    prisma.placement.count({ where: { id: { in: created.placementIds } } }),
    prisma.hourLog.count({ where: { placementId: { in: created.placementIds } } }),
    prisma.application.count({ where: { id: { in: created.applicationIds } } }),
    prisma.offer.count({ where: { id: { in: created.offerIds } } }),
    prisma.user.count({ where: { id: { in: created.userIds } } }),
    prisma.company.count({ where: { id: created.companyId } }),
  ])
  await prisma.$disconnect()
  expect(leftovers).toEqual([0, 0, 0, 0, 0, 0])
})

describe('N-3 — plaza COMPLETED al alcanzar las horas requeridas (Postgres real)', () => {
  it('la aprobación que alcanza justo requiredHours completa la plaza y sube su version', async () => {
    const placementId = await newPlacement()
    const before = await placementOf(placementId)
    await newLog(placementId, 4, HourLogStatus.APPROVED)
    const last = await newLog(placementId, 4)

    await service.review(last, HourLogStatus.APPROVED, tutorId)

    const after = await placementOf(placementId)
    expect(after.status).toBe(PlacementStatus.COMPLETED)
    expect(after.version).toBe(before.version + 1)
  })

  it('por debajo del umbral la plaza sigue ACTIVE', async () => {
    const placementId = await newPlacement()
    const before = await placementOf(placementId)
    const log = await newLog(placementId, 7.5)

    await service.review(log, HourLogStatus.APPROVED, tutorId)

    const after = await placementOf(placementId)
    expect(after.status).toBe(PlacementStatus.ACTIVE)
    expect(after.version).toBe(before.version)
  })

  it('rechazar horas no completa la plaza', async () => {
    const placementId = await newPlacement()
    await newLog(placementId, 4, HourLogStatus.APPROVED)
    const log = await newLog(placementId, 4)

    await service.review(log, HourLogStatus.REJECTED, tutorId)

    expect((await placementOf(placementId)).status).toBe(PlacementStatus.ACTIVE)
  })

  it('una plaza que no está ACTIVE no cambia aunque se alcance el umbral', async () => {
    const placementId = await newPlacement(PlacementStatus.SUSPENDED)
    const log = await newLog(placementId, 8)

    await service.review(log, HourLogStatus.APPROVED, tutorId)

    expect((await placementOf(placementId)).status).toBe(PlacementStatus.SUSPENDED)
  })

  it('aprobaciones simultáneas que juntas alcanzan el umbral dejan la plaza COMPLETED (una sola vez)', async () => {
    const placementId = await newPlacement()
    const before = await placementOf(placementId)
    // Ocho registros de 1 h amplían la ventana de la carrera (sin el bloqueo ninguna ve a las demás).
    const logs = await Promise.all(Array.from({ length: REQUIRED }, () => newLog(placementId, 1)))

    await Promise.all(logs.map((id) => service.review(id, HourLogStatus.APPROVED, tutorId)))

    const after = await placementOf(placementId)
    expect(after.status).toBe(PlacementStatus.COMPLETED)
    expect(after.version).toBe(before.version + 1)
  })

  it('dos aprobaciones simultáneas de 4 h completan la plaza', async () => {
    const placementId = await newPlacement()
    const [a, b] = [await newLog(placementId, 4), await newLog(placementId, 4)]

    await Promise.all([service.review(a, HourLogStatus.APPROVED, tutorId), service.review(b, HourLogStatus.APPROVED, tutorId)])

    expect((await placementOf(placementId)).status).toBe(PlacementStatus.COMPLETED)
  })

  it('una plaza COMPLETED rechaza nuevas horas por create', async () => {
    const placementId = await newPlacement(PlacementStatus.COMPLETED)
    const { studentId } = await placementOf(placementId)

    await expect(
      service.create(
        { placementId, date: new Date('2026-06-01'), startTime: '08:00', endTime: '10:00', hours: 2, activity: 'Actividad de prueba' },
        studentId,
      ),
    ).rejects.toThrow(/no está activo/)
  })
})
