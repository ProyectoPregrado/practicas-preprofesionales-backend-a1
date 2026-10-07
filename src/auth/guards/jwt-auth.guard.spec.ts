import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { describe, expect, it } from 'vitest'
import { JwtAuthGuard } from './jwt-auth.guard'

function contextFor(request: { headers: { authorization?: string }; user?: unknown }) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never
}

describe('JwtAuthGuard — E3-03 (expiración real, sin mocks de jwt)', () => {
  const jwt = new JwtService({ secret: 'secreto-de-test-no-usar-en-otro-lado' })
  const guard = new JwtAuthGuard(jwt)

  it('rechaza un token expirado', async () => {
    const expired = await jwt.signAsync({ sub: 1 }, { expiresIn: -10 })
    const request = { headers: { authorization: `Bearer ${expired}` } }

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(UnauthorizedException)
  })

  it('acepta un token vigente y expone el payload en request.user', async () => {
    const valid = await jwt.signAsync({ sub: 1, role: 'STUDENT' }, { expiresIn: '15m' })
    const request: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: `Bearer ${valid}` },
    }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toMatchObject({ sub: 1, role: 'STUDENT' })
  })

  it('rechaza cuando falta el header Authorization', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(UnauthorizedException)
  })

  it('rechaza un token firmado con otro secreto', async () => {
    const otherJwt = new JwtService({ secret: 'otro-secreto-distinto' })
    const foreign = await otherJwt.signAsync({ sub: 1 }, { expiresIn: '15m' })
    const request = { headers: { authorization: `Bearer ${foreign}` } }

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(UnauthorizedException)
  })
})
