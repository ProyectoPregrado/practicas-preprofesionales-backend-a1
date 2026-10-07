import { describe, expect, it } from 'vitest'
import { getRequiredJwtSecret } from './jwt-secret'

describe('getRequiredJwtSecret — E3-04', () => {
  it('lanza un error explícito si falta JWT_SECRET', () => {
    expect(() => getRequiredJwtSecret({} as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/)
  })

  it('el mensaje de error dice exactamente qué falta y cómo resolverlo', () => {
    try {
      getRequiredJwtSecret({} as NodeJS.ProcessEnv)
      throw new Error('no debería llegar acá')
    } catch (err) {
      expect((err as Error).message).toContain('JWT_SECRET')
      expect((err as Error).message).toContain('openssl')
    }
  })

  it('no propone ningún valor por defecto silencioso en el mensaje', () => {
    try {
      getRequiredJwtSecret({} as NodeJS.ProcessEnv)
      throw new Error('no debería llegar acá')
    } catch (err) {
      expect((err as Error).message).not.toMatch(/dev-secret/i)
    }
  })

  it('lanza también si la variable existe pero está vacía', () => {
    expect(() => getRequiredJwtSecret({ JWT_SECRET: '' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/)
  })

  it('devuelve el secreto tal cual cuando la variable está definida', () => {
    expect(getRequiredJwtSecret({ JWT_SECRET: 'un-secreto-de-prueba' } as NodeJS.ProcessEnv)).toBe(
      'un-secreto-de-prueba',
    )
  })
})
