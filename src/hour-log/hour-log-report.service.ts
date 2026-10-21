import { Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus } from '@prisma/client'
import { isoWeekLabel } from '../common/calendar-date'
import { PrismaService } from '../prisma/prisma.service'

// Consultas y agregaciones; las semanas ISO usan el helper en UTC de E6-02.
@Injectable()
export class HourLogReportService {
  constructor(private readonly prisma: PrismaService) {}

  async approvedHours(placementId: number): Promise<number> {
    const result = await this.prisma.hourLog.aggregate({
      where: { placementId, status: HourLogStatus.APPROVED, deletedAt: null },
      _sum: { hours: true },
    })
    return result._sum.hours ?? 0
  }

  async progressReport(placementId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const approved = await this.approvedHours(placementId)
    const pending = await this.prisma.hourLog.count({
      where: { placementId, status: HourLogStatus.SUBMITTED, deletedAt: null },
    })
    return {
      placementId,
      requiredHours: placement.requiredHours,
      approvedHours: approved,
      pendingLogs: pending,
      percentage: Math.round((approved / placement.requiredHours) * 100),
    }
  }

  async weeklySummary(placementId: number): Promise<
    {
      week: string
      approvedHours: number
      submittedHours: number
      logsCount: number
      expectedHoursPercentage: number
    }[]
  > {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')

    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })
    const totalDays = Math.max(
      1,
      Math.ceil((placement.endDate.getTime() - placement.startDate.getTime()) / 86400000),
    )
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7))
    const expectedHoursPerWeek = placement.requiredHours / totalWeeks
    const buckets = new Map<string, { approvedHours: number; submittedHours: number; logsCount: number }>()

    for (const log of logs) {
      if (log.status !== HourLogStatus.APPROVED && log.status !== HourLogStatus.SUBMITTED) {
        continue
      }

      const week = isoWeekLabel(log.date)
      const bucket = buckets.get(week) ?? { approvedHours: 0, submittedHours: 0, logsCount: 0 }

      if (log.status === HourLogStatus.APPROVED) {
        bucket.approvedHours += log.hours
      } else {
        bucket.submittedHours += log.hours
      }
      bucket.logsCount += 1

      buckets.set(week, bucket)
    }

    const summary: {
      week: string
      approvedHours: number
      submittedHours: number
      logsCount: number
      expectedHoursPercentage: number
    }[] = []

    for (const [week, bucket] of buckets.entries()) {
      const expectedHoursPercentage =
        expectedHoursPerWeek > 0 ? Math.round((bucket.approvedHours / expectedHoursPerWeek) * 100) : 0

      summary.push({
        week,
        approvedHours: bucket.approvedHours,
        submittedHours: bucket.submittedHours,
        logsCount: bucket.logsCount,
        expectedHoursPercentage,
      })
    }
    summary.sort((a, b) => {
      if (a.week < b.week) return -1
      if (a.week > b.week) return 1
      return 0
    })

    return summary
  }
}
