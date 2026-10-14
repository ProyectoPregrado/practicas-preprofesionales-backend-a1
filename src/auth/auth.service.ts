import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { generateRefreshToken, hashRefreshToken } from './refresh-token'
import { getAccessTokenTtl, getRefreshTokenTtlMs } from './token-config'

type SessionUser = {
  id: number
  email: string
  fullName: string
  role: Role
  companyId: number | null
}

const SESSION_EXPIRED_MESSAGE = 'la sesión expiró, iniciá sesión de nuevo'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('credenciales inválidas')
    }
    return this.issueSession({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      companyId: user.companyId,
    })
  }

  // E3-03: renovar la sesión sin pedir credenciales de nuevo. Renovar invalida
  // siempre el refresh token usado, sea válido o no — reintentar con uno ya
  // usado nunca emite una sesión nueva (evita que un token robado y reutilizado
  // pase inadvertido).
  async refresh(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken)
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE)
    }

    // La exclusividad la da el UPDATE condicionado a revokedAt: null, no una
    // lectura previa (misma lección de E1-03b): si dos requests llegan con el
    // mismo refresh token casi a la vez, solo uno gana la revocación y emite
    // sesión nueva; el otro cae acá con count 0 y no reintenta.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (revoked.count === 0) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE)
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } })
    if (!user) throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE)

    return this.issueSession({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      companyId: user.companyId,
    })
  }

  // T-2: cerrar sesión revoca el refresh token presentado. Es idempotente y no revela si el token
  // existía: un token desconocido o ya revocado simplemente no coincide con ninguna fila.
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  private async issueSession(user: SessionUser) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: getAccessTokenTtl() },
    )

    const refreshToken = generateRefreshToken()
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + getRefreshTokenTtlMs()),
      },
    })

    return {
      accessToken,
      refreshToken,
      // companyId solo es relevante para Role.COMPANY (ver User.companyId en
      // el schema); el resto de roles lo trae null. El front lo necesita para
      // armar CreateOfferDto sin tener que adivinar o listar todas las empresas.
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, companyId: user.companyId },
    }
  }
}
