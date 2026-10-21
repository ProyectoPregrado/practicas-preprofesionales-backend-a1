import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ConflictException } from '@nestjs/common'
import { ApplicationStatus, EvaluationKind, OfferStatus, PlacementStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EvaluationService } from './evaluation.service'

// D-12 — Una sola evaluación vigente por plaza, tipo y periodo (Postgres real). Sin la restricción de la base,
// dos envíos simultáneos no ven la del otro y las dos se guardan; entonces la acreditación no sabe cuál contar.
const prisma = new PrismaClient()
const service = new EvaluationService(prisma as never)
const suffix = `${Date.now()}`
const created = { userIds: [] as number[], placementIds: [] as number[], applicationIds: [] as number[], offerIds: [] as number[], companyId: 0 }
let tutorId = 0
let seq = 0

const scores = { technical: 4, communication: 5, punctuality: 3 }
const dto = (placementId: number, period = '2026-1', kind: EvaluationKind = EvaluationKind.TUTOR) => ({
  placementId,
  kind,
  period,
  scores,
})
const countOf = (placementId: number, where: object = {}) =>
  prisma.evaluation.count({ where: { placementId, ...where } })

const newUser = async (role: Role, label: string) => {
  seq += 1
  const user = await prisma.user.create({
    data: { email: `d12-${label}-${suffix}-${seq}@test.local`, password: randomUUID(), fullName: label, role },
  })
  created.userIds.push(user.id)
  return user.id
}

// Cada plaza usa su propio estudiante para respetar el índice de una sola plaza ACTIVE por estudiante (N-1).
const newPlacement = async () => {
  const studentId = await newUser(Role.STUDENT, 'student')
  const offer = await prisma.offer.create({
    data: {
      companyId: created.companyId, title: `D-12 ${suffix}-${seq}`, description: 'x', modality: 'PRESENCIAL', seats: 1, requiredHours: 8,
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
      endDate: new Date('2026-07-31'), requiredHours: 8, status: PlacementStatus.ACTIVE,
    },
  })
  created.placementIds.push(placement.id)
  return { placementId: placement.id, studentId }
}

beforeAll(async () => {
  await prisma.$connect()
  created.companyId = (
    await prisma.company.create({
      data: { taxId: `TAX-d12-${suffix}`, name: `Empresa d12 ${suffix}`, sector: 'TI', contactEmail: `d12-${suffix}@test.local` },
    })
  ).id
  tutorId = await newUser(Role.TUTOR, 'tutor')
})

afterAll(async () => {
  await prisma.evaluation.deleteMany({ where: { placementId: { in: created.placementIds } } })
  await prisma.placement.deleteMany({ where: { id: { in: created.placementIds } } })
  await prisma.application.deleteMany({ where: { id: { in: created.applicationIds } } })
  await prisma.offer.deleteMany({ where: { id: { in: created.offerIds } } })
  await prisma.company.deleteMany({ where: { id: created.companyId } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  await prisma.$disconnect()
})

describe('EvaluationService.submit — una evaluación vigente por plaza, tipo y periodo (D-12)', () => {
  it('con dos envíos simultáneos, uno gana y el otro recibe 409', async () => {
    const { placementId } = await newPlacement()

    const results = await Promise.allSettled([
      service.submit(dto(placementId), tutorId, Role.TUTOR),
      service.submit(dto(placementId), tutorId, Role.TUTOR),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ConflictException)
    expect(await countOf(placementId)).toBe(1)
  })

  it('un envío posterior del mismo tipo y periodo también recibe 409 y no cambia lo guardado', async () => {
    const { placementId } = await newPlacement()
    await service.submit(dto(placementId), tutorId, Role.TUTOR)

    await expect(
      service.submit({ ...dto(placementId), scores: { technical: 1, communication: 1, punctuality: 1 } }, tutorId, Role.TUTOR),
    ).rejects.toThrow(ConflictException)

    const [saved] = await prisma.evaluation.findMany({ where: { placementId } })
    expect(saved.scores).toEqual(scores)
  })

  it('el 409 explica qué pasó', async () => {
    const { placementId } = await newPlacement()
    await service.submit(dto(placementId), tutorId, Role.TUTOR)

    await expect(service.submit(dto(placementId), tutorId, Role.TUTOR)).rejects.toThrow(
      'ya hay una evaluación de este periodo para esta práctica',
    )
  })

  it('otro periodo de la misma plaza sí se acepta', async () => {
    const { placementId } = await newPlacement()
    await service.submit(dto(placementId, '2026-1'), tutorId, Role.TUTOR)

    await service.submit(dto(placementId, '2026-2'), tutorId, Role.TUTOR)

    expect(await countOf(placementId)).toBe(2)
  })

  it('otro tipo de evaluación en el mismo periodo sí se acepta (la autoevaluación del estudiante)', async () => {
    const { placementId, studentId } = await newPlacement()
    await service.submit(dto(placementId), tutorId, Role.TUTOR)

    await service.submit(dto(placementId, '2026-1', EvaluationKind.SELF), studentId, Role.STUDENT)

    expect(await countOf(placementId)).toBe(2)
  })

  it('una evaluación borrada (deletedAt) no bloquea una nueva del mismo periodo', async () => {
    const { placementId } = await newPlacement()
    const first = await service.submit(dto(placementId), tutorId, Role.TUTOR)
    await prisma.evaluation.update({ where: { id: first.id }, data: { deletedAt: new Date() } })

    await service.submit(dto(placementId), tutorId, Role.TUTOR)

    expect(await countOf(placementId, { deletedAt: null })).toBe(1)
  })
})
