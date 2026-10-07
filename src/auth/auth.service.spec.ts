import { UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from './auth.service'
import { hashRefreshToken } from './refresh-token'

// Smell deliberado: mockeamos PrismaService completo, así que estos tests
// no ejercitan SQL real y no detectan N+1 ni races.
const prisma = {
  user: { findUnique: vi.fn() },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
}
const jwt = { signAsync: vi.fn().mockResolvedValue('token-firmado') }

describe('AuthService.login', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.refreshToken.create.mockResolvedValue(undefined)
    service = new AuthService(prisma as never, jwt as never)
  })

  it('returns an access token and the user for valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    const result = await service.login('tutor0@miyura.com', 'yura1234')

    expect(result.accessToken).toBe('token-firmado')
    expect(result.user).toEqual({ id: 1, email: 'tutor0@miyura.com', fullName: 'Tutor Académico 0', role: 'TUTOR' })
  })

  it('includes companyId for a COMPANY user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 2, email: 'empresa0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Empresa 0', role: 'COMPANY', companyId: 1,
    })

    const result = await service.login('empresa0@miyura.com', 'yura1234')

    expect(result.user).toEqual({
      id: 2, email: 'empresa0@miyura.com', fullName: 'Empresa 0', role: 'COMPANY', companyId: 1,
    })
  })

  it('throws Unauthorized when the password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('otra', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    await expect(service.login('tutor0@miyura.com', 'yura1234')).rejects.toThrow(UnauthorizedException)
  })

  // -------------------------------------------------------------------------
  // E3-03 — expiración configurable y emisión de refresh token
  // -------------------------------------------------------------------------

  it('E3-03: firma el access token con una expiración configurable', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    await service.login('tutor0@miyura.com', 'yura1234')

    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1 }),
      expect.objectContaining({ expiresIn: expect.any(String) }),
    )
  })

  it('E3-03: emite un refresh token y guarda solo su hash, nunca en texto plano', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    const result = await service.login('tutor0@miyura.com', 'yura1234')

    expect(result.refreshToken).toBeTypeOf('string')
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1)
    const savedData = prisma.refreshToken.create.mock.calls[0][0].data
    expect(savedData.tokenHash).toBe(hashRefreshToken(result.refreshToken))
    expect(savedData.tokenHash).not.toBe(result.refreshToken)
    expect(savedData.expiresAt).toBeInstanceOf(Date)
    expect(savedData.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('AuthService.refresh — E3-03', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.refreshToken.create.mockResolvedValue(undefined)
    service = new AuthService(prisma as never, jwt as never)
  })

  it('renueva la sesión con un refresh token válido y no vencido', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 99, userId: 1, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 })
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    const result = await service.refresh('un-refresh-token-cualquiera')

    expect(result.accessToken).toBe('token-firmado')
    expect(result.refreshToken).toBeTypeOf('string')
  })

  it('invalida el refresh token usado: el UPDATE se condiciona a revokedAt: null', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 99, userId: 1, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 })
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@miyura.com', fullName: 'A', role: 'TUTOR' })

    await service.refresh('token')

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 99, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('rechaza un refresh token que no existe', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null)

    await expect(service.refresh('token-inexistente')).rejects.toThrow(UnauthorizedException)
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
  })

  it('rechaza un refresh token ya revocado (reutilizado)', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 99, userId: 1, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    })

    await expect(service.refresh('token-ya-usado')).rejects.toThrow(UnauthorizedException)
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
  })

  it('rechaza un refresh token vencido', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 99, userId: 1, revokedAt: null, expiresAt: new Date(Date.now() - 1000),
    })

    await expect(service.refresh('token-vencido')).rejects.toThrow(UnauthorizedException)
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
  })

  it('E3-03b-style: dos usos concurrentes del mismo refresh token no emiten dos sesiones', async () => {
    // Simula la carrera: ambas lecturas ven el token todavía vigente, pero
    // el UPDATE condicionado a revokedAt: null solo puede ganarlo una vez
    // (la base lo garantiza; acá se simula con el segundo updateMany
    // devolviendo count 0, que es la respuesta real de Postgres en ese caso).
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 99, userId: 1, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    prisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@miyura.com', fullName: 'A', role: 'TUTOR' })

    const [first, second] = await Promise.allSettled([
      service.refresh('mismo-token'),
      service.refresh('mismo-token'),
    ])

    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('rejected')
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1)
  })
})
