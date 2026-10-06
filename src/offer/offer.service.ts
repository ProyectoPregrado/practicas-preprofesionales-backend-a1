import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, OfferStatus, Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateOfferDto } from './dto/create-offer.dto'

@Injectable()
export class OfferService {
  constructor(private readonly prisma: PrismaService) {}

  // El JWT no trae `companyId` (solo `sub` y `role`), así que se lee del usuario.
  private async companyIdOf(userId: number): Promise<number | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
    return user?.companyId ?? null
  }

  /**
   * E3-01 / H-4: crear, publicar o cerrar una oferta solo lo hace la coordinación o la empresa
   * a la que pertenece. Vive en el servicio, no en el controlador, para que llamarlo directo con
   * una empresa ajena también falle.
   */
  private async assertCompanyAccess(companyId: number, userId: number, role: Role, message: string): Promise<void> {
    if (role === Role.COORDINATOR) return
    if (role !== Role.COMPANY || (await this.companyIdOf(userId)) !== companyId) {
      throw new ForbiddenException(message)
    }
  }

  async create(dto: CreateOfferDto, userId: number, role: Role) {
    await this.assertCompanyAccess(dto.companyId, userId, role, 'solo puedes crear ofertas a nombre de tu empresa')
    return this.prisma.offer.create({ data: { ...dto, status: OfferStatus.DRAFT } })
  }

  findAll() {
    return this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      include: { company: true },
    })
  }

  async findOne(id: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: { company: true } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    return offer
  }

  // Ofertas de la empresa del usuario autenticado, en cualquier estado —
  // a diferencia de findAll() (solo PUBLISHED, para el catálogo del estudiante).
  // Incluye el estado de las postulaciones para que la empresa vea cupos
  // ocupados sin que el front tenga que pedir una lista aparte por oferta.
  async findAllForCompanyUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
    if (!user?.companyId) throw new NotFoundException('el usuario no tiene una empresa asociada')
    return this.prisma.offer.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
      include: { company: true, applications: { select: { status: true } } },
    })
  }

  async publish(id: number, userId: number, role: Role) {
    const offer = await this.prisma.offer.findUnique({ where: { id } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    // Antes que las reglas de estado: una empresa ajena recibe 403, no un 400 que revele el estado.
    await this.assertCompanyAccess(offer.companyId, userId, role, 'la oferta no es de tu empresa')
    if (offer.status !== OfferStatus.DRAFT) {
      throw new BadRequestException('solo se publican ofertas en DRAFT')
    }
    return this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.PUBLISHED, publishedAt: new Date() },
    })
  }

  async close(id: number, userId: number, role: Role) {
    const offer = await this.prisma.offer.findUnique({ where: { id } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    await this.assertCompanyAccess(offer.companyId, userId, role, 'la oferta no es de tu empresa')
    if (offer.status !== OfferStatus.PUBLISHED) {
      throw new BadRequestException('solo se cierran ofertas publicadas')
    }
    return this.prisma.offer.update({ where: { id }, data: { status: OfferStatus.CLOSED } })
  }

  // Cuenta las postulaciones ya aceptadas para una oferta.
  acceptedCount(offerId: number): Promise<number> {
    return this.prisma.application.count({
      where: { offerId, status: ApplicationStatus.ACCEPTED },
    })
  }
}
