import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DocumentKind, DocumentStatus, PlacementStatus, Role } from '@prisma/client'
import { PUBLIC_COMPANY_SELECT } from '../company/company.select'
import { PrismaService } from '../prisma/prisma.service'
import type { UploadDocumentDto } from './dto/upload-document.dto'

const REQUIRED_DOCS: DocumentKind[] = [DocumentKind.AGREEMENT, DocumentKind.INSURANCE]

// PostgreSQL reports the partial index as its name or its single indexed column.
function isActiveStudentConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  return target === 'placements_one_active_per_student'
    || (Array.isArray(target) && target.length === 1 && target[0] === 'studentId')
}

@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromApplication(applicationId: number, tutorId: number) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { offer: true },
    })
    if (!application) throw new NotFoundException('postulación no encontrada')
    if (application.status !== 'ACCEPTED') {
      throw new BadRequestException('la postulación no está aceptada')
    }

    const active = await this.prisma.placement.findFirst({
      where: { studentId: application.studentId, status: PlacementStatus.ACTIVE },
    })
    if (active) throw new BadRequestException('el estudiante ya tiene un placement activo')

    return this.prisma.placement.create({
      data: {
        applicationId,
        studentId: application.studentId,
        tutorId,
        companyId: application.offer.companyId,
        startDate: application.offer.periodStart,
        endDate: application.offer.periodEnd,
        requiredHours: application.offer.requiredHours,
        status: PlacementStatus.PENDING_DOCS,
      },
    })
  }

  async activate(id: number) {
    const placement = await this.prisma.placement.findUnique({
      where: { id },
      include: { documents: true },
    })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (placement.status !== PlacementStatus.PENDING_DOCS) {
      throw new BadRequestException('solo se activan placements en PENDING_DOCS')
    }

    const missing = REQUIRED_DOCS.filter(
      (kind) => !placement.documents.some((d) => d.kind === kind && d.status === DocumentStatus.VALIDATED),
    )
    if (missing.length > 0) {
      throw new BadRequestException(`faltan documentos validados: ${missing.join(', ')}`)
    }

    try {
      return await this.prisma.placement.update({
        where: { id },
        data: { status: PlacementStatus.ACTIVE },
      })
    } catch (error) {
      // N-1: the database arbitrates concurrent activations; a prior read cannot.
      if (isActiveStudentConflict(error)) {
        throw new ConflictException('el estudiante ya tiene un placement activo')
      }
      throw error
    }
  }

  findForStudent(studentId: number) {
    return this.prisma.placement.findFirst({
      where: { studentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        // H-6: sin `taxId` ni `contactEmail`; el estudiante solo necesita los datos públicos.
        company: { select: PUBLIC_COMPANY_SELECT },
        // `tutor: true` filtraría el hash de contraseña del tutor en la respuesta.
        tutor: { select: { id: true, fullName: true, email: true } },
        documents: true,
      },
    })
  }

  async addDocument(placementId: number, dto: UploadDocumentDto, uploadedById: number, role: Role) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (role !== Role.COORDINATOR && placement.studentId !== uploadedById) {
      throw new ForbiddenException('el placement no es tuyo')
    }

    return this.prisma.document.create({
      data: { ...dto, placementId, uploadedById, status: DocumentStatus.PENDING },
    })
  }
}
