import { randomUUID } from 'node:crypto'
import { type INestApplication } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { Role } from '@prisma/client'
import { performance } from 'node:perf_hooks'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { createPostgresTestDatabase, postgresTestUrl } from '../test/postgres-database'
import { ApplicationModule } from './application.module'

describe.skipIf(!postgresTestUrl)('E2-03: application listing on PostgreSQL and HTTP', () => {
  let database: Awaited<ReturnType<typeof createPostgresTestDatabase>>
  let app: INestApplication
  let jwt: JwtService
  let companyId: number
  let ownerId: number
  let foreignId: number

  beforeAll(async () => {
    database = await createPostgresTestDatabase()
    const module = await Test.createTestingModule({
      imports: [PrismaModule, ApplicationModule, JwtModule.register({ global: true, secret: 'e2-03-test-secret' })],
    }).overrideProvider(PrismaService).useValue(database.prisma).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()
    jwt = module.get(JwtService)
    const company = await database.prisma.company.create({
      data: { taxId: 'E2-03', name: 'Test company', sector: 'Software', contactEmail: 'company@test.invalid' },
    })
    companyId = company.id
    const owner = await database.prisma.user.create({
      data: { email: 'owner@test.invalid', fullName: 'Owner', password: randomUUID(), role: Role.COMPANY, companyId },
    })
    const foreign = await database.prisma.user.create({
      data: { email: 'foreign@test.invalid', fullName: 'Foreign', password: randomUUID(), role: Role.COMPANY },
    })
    ownerId = owner.id
    foreignId = foreign.id
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  async function createOffer(count: number) {
    const offer = await database.prisma.offer.create({
      data: {
        companyId, title: `Offer ${count}`, description: 'Test', modality: 'REMOTE', seats: 300,
        requiredHours: 240, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
      },
    })
    await database.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        email: `${offer.id}-${i}@test.invalid`, fullName: `Student ${i}`, password: randomUUID(),
      })),
    })
    const students = await database.prisma.user.findMany({ where: { email: { startsWith: `${offer.id}-` }, role: Role.STUDENT } })
    const candidates = students.filter((student) => student.email.startsWith(`${offer.id}-`))
    if (count > 0) {
      await database.prisma.application.createMany({
        data: candidates.map((student) => ({ offerId: offer.id, studentId: student.id, motivation: 'Test' })),
      })
    }
    return { offer, candidates }
  }

  it.each([1, 20, 250])('returns %i candidates with bounded SQL after warmup and safe student data', async (count) => {
    const { offer, candidates } = await createOffer(count)
    const path = `/api/offers/${offer.id}/applications`
    const token = jwt.sign({ sub: ownerId, role: Role.COMPANY })
    // Warm the pool and HTTP route before measuring steady-state SQL and latency.
    // Count every statement in the measured request; keep the N+1 bound at four.
    await request(app.getHttpServer()).get(path).auth(token, { type: 'bearer' }).expect(200)
    database.queries.length = 0
    const start = performance.now()
    const response = await request(app.getHttpServer())
      .get(path)
      .auth(token, { type: 'bearer' })
      .expect(200)
    const sqlCount = database.queries.length
    console.info(`E2-03 candidates=${count} sql=${sqlCount} httpMs=${(performance.now() - start).toFixed(2)}`)

    expect(response.body).toHaveLength(count)
    if (sqlCount > 4) console.info('E2-03 unexpected measured SQL:', [...new Set(database.queries)])
    expect(sqlCount).toBeGreaterThan(0)
    expect(sqlCount).toBeLessThanOrEqual(4) // Two permission reads plus two batched relation reads.
    for (const row of response.body) {
      const student = candidates.find((candidate) => candidate.id === row.studentId)
      expect(row.student).toEqual({ id: student?.id, email: student?.email, fullName: student?.fullName })
      expect(row).toMatchObject({ offerId: offer.id, motivation: 'Test', status: 'SUBMITTED' })
    }
  })

  it('returns an empty list, permits coordinators and still denies a foreign company', async () => {
    const { offer } = await createOffer(0)
    await request(app.getHttpServer()).get(`/api/offers/${offer.id}/applications`)
      .auth(jwt.sign({ sub: ownerId, role: Role.COMPANY }), { type: 'bearer' }).expect(200, [])
    await request(app.getHttpServer()).get(`/api/offers/${offer.id}/applications`)
      .auth(jwt.sign({ sub: ownerId, role: Role.COORDINATOR }), { type: 'bearer' }).expect(200, [])
    const denied = await request(app.getHttpServer()).get(`/api/offers/${offer.id}/applications`)
      .auth(jwt.sign({ sub: foreignId, role: Role.COMPANY }), { type: 'bearer' }).expect(403)
    expect(denied.body.statusCode).toBe(403)
  })
})
