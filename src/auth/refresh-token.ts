import { createHash, randomBytes } from 'crypto'

// E3-03: el refresh token viaja en texto plano al cliente (como cualquier
// token de sesión) pero se guarda hasheado — el mismo criterio que ya se
// aplica a password. Si la base se filtra, no expone sesiones reutilizables.
export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
