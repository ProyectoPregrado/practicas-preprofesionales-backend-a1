import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus, PlacementStatus, Role } from '@prisma/client'
import { dailyHoursError, hoursRangeError, timeOrderError, withStudentHoursLock } from './hour-rules'
import { completePlacementIfReached, withPlacementApprovalLock } from './placement-completion'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateHourLogDto } from './dto/create-hour-log.dto'
import { HourLogNotificationService } from './hour-log-notification.service'
import { HourLogReportService } from './hour-log-report.service'
import { HourLogExportService } from './hour-log-export.service'

// Orquesta las escrituras y conserva la API pública del módulo.
// Los bloqueos y sus escrituras permanecen juntos: E6-01 por estudiante y N-3 por plaza.
@Injectable()
export class HourLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: HourLogNotificationService,
    private readonly reports: HourLogReportService,
    private readonly exporter: HourLogExportService,
  ) {}

  async create(dto: CreateHourLogDto, studentId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: dto.placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (placement.studentId !== studentId) throw new BadRequestException('el placement no es tuyo')
    if (placement.status !== PlacementStatus.ACTIVE) {
      throw new BadRequestException('el placement no está activo')
    }

    const rangeError = hoursRangeError(dto.hours) ?? timeOrderError(dto.startTime, dto.endTime)
    if (rangeError) throw new BadRequestException(rangeError)

    const created = await withStudentHoursLock(this.prisma, studentId, async (tx) => {
      const dailyError = await dailyHoursError(tx, studentId, dto.date, dto.hours)
      if (dailyError) throw new BadRequestException(dailyError)
      return tx.hourLog.create({
        data: {
          placementId: dto.placementId,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          hours: dto.hours,
          activity: dto.activity,
          status: HourLogStatus.SUBMITTED,
        },
      })
    })

    this.notifications.notifyTutor(placement.tutorId, created.id)
    return created
  }

  async assertPlacementAccess(placementId: number, userId: number, role: Role): Promise<void> {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const allowed = role === Role.COORDINATOR || placement.studentId === userId || placement.tutorId === userId
    if (!allowed) throw new ForbiddenException('no tienes acceso a este placement')
  }

  listForPlacement(placementId: number) {
    return this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'desc' },
    })
  }

  async review(id: number, status: HourLogStatus, reviewerId: number, note?: string) {
    const log = await this.prisma.hourLog.findUnique({
      where: { id },
      include: { placement: { select: { tutorId: true } } },
    })
    if (!log) throw new NotFoundException('registro de horas no encontrado')
    if (log.placement.tutorId !== reviewerId) {
      throw new ForbiddenException('solo el tutor asignado al placement puede revisar sus horas')
    }
    if (log.status !== HourLogStatus.SUBMITTED) {
      throw new BadRequestException('solo se revisan registros en SUBMITTED')
    }

    await withPlacementApprovalLock(this.prisma, log.placementId, async (tx) => {
      const result = await tx.hourLog.updateMany({
        where: {
          id,
          status: HourLogStatus.SUBMITTED,
          placement: { tutorId: reviewerId },
        },
        data: {
          status,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNote: note,
          version: { increment: 1 },
        },
      })

      if (result.count !== 1) {
        throw new BadRequestException('solo se revisan registros en SUBMITTED')
      }

      if (status === HourLogStatus.APPROVED) await completePlacementIfReached(tx, log.placementId)
    })

    const updated = await this.prisma.hourLog.findUnique({ where: { id } })
    if (!updated) throw new NotFoundException('registro de horas no encontrado')
    return updated
  }

  approvedHours(placementId: number): Promise<number> {
    return this.reports.approvedHours(placementId)
  }

  progressReport(placementId: number) {
    return this.reports.progressReport(placementId)
  }

  weeklySummary(placementId: number) {
    return this.reports.weeklySummary(placementId)
  }

  exportRows(placementId: number): Promise<(string | number)[][]> {
    return this.exporter.exportRows(placementId)
  }
}
