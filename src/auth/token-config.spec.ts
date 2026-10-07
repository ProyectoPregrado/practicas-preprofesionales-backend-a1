import { describe, expect, it } from 'vitest'
import { getAccessTokenTtl, getRefreshTokenTtlMs } from './token-config'

describe('token-config — E3-03', () => {
  it('usa 15m por defecto si no hay JWT_EXPIRES_IN', () => {
    expect(getAccessTokenTtl({} as NodeJS.ProcessEnv)).toBe('15m')
  })

  it('es configurable vía JWT_EXPIRES_IN', () => {
    expect(getAccessTokenTtl({ JWT_EXPIRES_IN: '5m' } as NodeJS.ProcessEnv)).toBe('5m')
  })

  it('usa 7 días por defecto para el refresh token si no hay REFRESH_TOKEN_TTL_DAYS', () => {
    expect(getRefreshTokenTtlMs({} as NodeJS.ProcessEnv)).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('es configurable vía REFRESH_TOKEN_TTL_DAYS', () => {
    expect(getRefreshTokenTtlMs({ REFRESH_TOKEN_TTL_DAYS: '1' } as NodeJS.ProcessEnv)).toBe(24 * 60 * 60 * 1000)
  })

  it('ignora un REFRESH_TOKEN_TTL_DAYS inválido y usa el default', () => {
    expect(getRefreshTokenTtlMs({ REFRESH_TOKEN_TTL_DAYS: 'no-es-un-numero' } as NodeJS.ProcessEnv)).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
  })
})
