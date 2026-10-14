import { randomUUID } from 'node:crypto'
import { ConflictException, type INestApplication } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DocumentKind, DocumentStatus, PlacementStatus, Role } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { createPostgresTestDatabase, postgresTestUrl } from '../test/postgres-database'
import { PlacementModule } from './placement.module'
import { PlacementService } from './placement.service'

describe.skipIf(!postgresTestUrl)('N-1: one ACTIVE placement per student on PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createPostgresTestDatabase>>
  let app: INestApplication
  let service: PlacementService
  let token: string
  let companyId: number
  let tutorId: number

  beforeAll(async () => {
    database = await createPostgresTestDatabase()
    const module = await Test.createTestingModule({
      imports: [PrismaModule, PlacementModule, JwtModule.register({ global: true, secret: 'n-1-test-secret' })],
    }).overrideProvider(PrismaService).useValue(database.prisma).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()
    service = module.get(PlacementService)
    token = module.get(JwtService).sign({ sub: 1, role: Role.COORDINATOR })
    const company = await database.prisma.company.create({
      data: { taxId: 'N-1', name: 'Test company', sector: 'Software', contactEmail: 'company@test.invalid' },
    })
    companyId = company.id
    const tutor = await database.prisma.user.create({
      data: { email: 'tutor@test.invalid', fullName: 'Tutor', password: randomUUID(), role: Role.TUTOR },
    })
    tutorId = tutor.id
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  async function pendingPlacements() {
    const student = await database.prisma.user.create({
      data: { email: randomUUID() + '@test.invalid', fullName: 'Student', password: randomUUID() },
    })
    const offers = await Promise.all([1, 2].map((i) => database.prisma.offer.create({
      data: {
        companyId, title: 'Offer ' + i, description: 'Test', modality: 'REMOTE', seats: 10,
        requiredHours: 240, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
      },
    })))
    const applications = await Promise.all(offers.map((offer) => database.prisma.application.create({
      data: { offerId: offer.id, studentId: student.id, motivation: 'Test', status: 'ACCEPTED' },
    })))
    const placements = await Promise.all(applications.map((application) => service.createFromApplication(application.id, tutorId)))
    await database.prisma.document.createMany({
      data: placements.flatMap((placement) => [DocumentKind.AGREEMENT, DocumentKind.INSURANCE].map((kind) => ({
        placementId: placement.id, kind, filename: 'validated.pdf', mimeType: 'application/pdf', size: 1,
        storageKey: randomUUID(), status: DocumentStatus.VALIDATED, uploadedById: student.id, validatedById: tutorId,
      }))),
    })
    expect(placements.map((placement) => placement.status)).toEqual([PlacementStatus.PENDING_DOCS, PlacementStatus.PENDING_DOCS])
    return { studentId: student.id, ids: placements.map((placement) => placement.id) }
  }

  it.each([false, true])('only one simultaneous HTTP activation wins (reverse=%s)', async (reverse) => {
    const { studentId, ids } = await pendingPlacements()
    const order = reverse ? [...ids].reverse() : ids
    const responses = await Promise.all(order.map((id) => request(app.getHttpServer())
      .patch('/api/placements/' + id + '/activate').auth(token, { type: 'bearer' })))

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const loser = responses.find((response) => response.status === 409)
    expect(loser?.body.message).toBe('el estudiante ya tiene un placement activo')
    const stored = await database.prisma.placement.findMany({ where: { studentId } })
    expect(stored.filter((placement) => placement.status === PlacementStatus.ACTIVE)).toHaveLength(1)
    expect(stored.filter((placement) => placement.status === PlacementStatus.PENDING_DOCS)).toHaveLength(1)
  })

  it('rejects a second sequential activation with a domain conflict', async () => {
    const { ids } = await pendingPlacements()
    await service.activate(ids[0])
    await expect(service.activate(ids[1])).rejects.toThrow(ConflictException)
    expect(await database.prisma.placement.findUnique({ where: { id: ids[1] } }))
      .toMatchObject({ status: PlacementStatus.PENDING_DOCS })
  })

  it('enforces exclusivity even when concurrent writes bypass the service', async () => {
    const { studentId, ids } = await pendingPlacements()
    const results = await Promise.allSettled(ids.map((id) => database.prisma.placement.update({
      where: { id }, data: { status: PlacementStatus.ACTIVE },
    })))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'P2002' })
    expect(await database.prisma.placement.count({ where: { studentId, status: PlacementStatus.ACTIVE } })).toBe(1)
  })

  it('allows another activation after the previous placement leaves ACTIVE', async () => {
    const { studentId, ids } = await pendingPlacements()
    await service.activate(ids[0])
    await database.prisma.placement.update({ where: { id: ids[0] }, data: { status: PlacementStatus.COMPLETED } })
    const activated = await service.activate(ids[1])
    expect(activated.status).toBe(PlacementStatus.ACTIVE)
    expect(await database.prisma.placement.count({ where: { studentId } })).toBe(2)
  })

  it('allows different students to activate concurrently', async () => {
    const fixtures = await Promise.all([pendingPlacements(), pendingPlacements()])
    const results = await Promise.all(fixtures.map((fixture) => service.activate(fixture.ids[0])))
    expect(results.map((placement) => placement.status)).toEqual([PlacementStatus.ACTIVE, PlacementStatus.ACTIVE])
  })
})
