import type { JwtSignOptions } from '@nestjs/jwt'

type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>

// E3-03: expiración corta y configurable del access token, y vida configurable
// del refresh token. Sin variable de entorno, quedan defaults razonables — a
// diferencia de JWT_SECRET (E3-04), acá no tiene sentido bloquear el arranque.
// El cast es responsabilidad de quien configura JWT_EXPIRES_IN: si el formato
// no es válido ("15m", "1d", etc.), jsonwebtoken lo rechaza en tiempo de
// ejecución al firmar, con un error explícito.
export function getAccessTokenTtl(env: NodeJS.ProcessEnv = process.env): ExpiresIn {
  return (env.JWT_EXPIRES_IN?.trim() || '15m') as ExpiresIn
}

export function getRefreshTokenTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.REFRESH_TOKEN_TTL_DAYS)
  const safeDays = Number.isFinite(days) && days > 0 ? days : 7
  return safeDays * 24 * 60 * 60 * 1000
}
