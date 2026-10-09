import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as bcrypt from 'bcryptjs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaService } from '../prisma/prisma.service'

// T-2 — Cerrar sesión revoca el refresh token en el servidor (HTTP real + Postgres real).
describe('POST /auth/logout (e2e) — T-2', () => {
  let app: INestApplication
  let prisma: PrismaService
  let userId = 0
  const password = randomUUID()
  const email = `t2-${Date.now()}@test.local`

  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/auth/${path}`).send(body)

  const login = async () => {
    const res = await post('login', { email, password })
    expect(res.status).toBe(201)
    return res.body.refreshToken as string
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()
    prisma = app.get(PrismaService)
    const user = await prisma.user.create({
      data: { email, password: await bcrypt.hash(password, 4), fullName: 'T-2', role: 'STUDENT' },
    })
    userId = user.id
  }, 30000)

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    await app.close()
  })

  it('responde 204 y el refresh token deja de servir para renovar la sesión', async () => {
    const refreshToken = await login()

    expect((await post('logout', { refreshToken })).status).toBe(204)

    expect((await post('refresh', { refreshToken })).status).toBe(401)
  })

  it('es idempotente: cerrar sesión dos veces con el mismo token también responde 204', async () => {
    const refreshToken = await login()

    expect((await post('logout', { refreshToken })).status).toBe(204)
    expect((await post('logout', { refreshToken })).status).toBe(204)
  })

  it('un token que no existe responde igual (204), sin revelar si era válido', async () => {
    expect((await post('logout', { refreshToken: 'f'.repeat(96) })).status).toBe(204)
  })

  it('cerrar una sesión no cierra las otras sesiones del mismo usuario', async () => {
    const sessionA = await login()
    const sessionB = await login()

    expect((await post('logout', { refreshToken: sessionA })).status).toBe(204)

    expect((await post('refresh', { refreshToken: sessionA })).status).toBe(401)
    expect((await post('refresh', { refreshToken: sessionB })).status).toBe(201)
  })

  it('rechaza con 400 un cuerpo sin refreshToken', async () => {
    expect((await post('logout', {})).status).toBe(400)
  })
})
