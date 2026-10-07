import { describe, expect, it } from 'vitest'
import { generateRefreshToken, hashRefreshToken } from './refresh-token'

describe('refresh-token — E3-03', () => {
  it('genera tokens distintos en cada llamada', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(64)
  })

  it('el hash es determinístico para el mismo token', () => {
    const token = generateRefreshToken()
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token))
  })

  it('el hash nunca es igual al token en texto plano', () => {
    const token = generateRefreshToken()
    expect(hashRefreshToken(token)).not.toBe(token)
  })
})
