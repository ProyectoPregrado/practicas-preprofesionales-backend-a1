import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { hoursRangeError, timeOrderError } from './hour-rules'

// Produce filas CSV y conserva la validación compartida de E6-01.
@Injectable()
export class HourLogExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportRows(placementId: number): Promise<(string | number)[][]> {
    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })

    const header = ['id', 'fecha', 'inicio', 'fin', 'horas', 'actividad', 'estado', 'revisadoPor']
    const rows: (string | number)[][] = [header]

    for (const dto of logs) {
      const ruleError = hoursRangeError(dto.hours) ?? timeOrderError(dto.startTime, dto.endTime)
      if (ruleError) throw new BadRequestException(ruleError)

      rows.push([
        dto.id,
        dto.date.toISOString().slice(0, 10),
        dto.startTime,
        dto.endTime,
        dto.hours,
        this.escapeCsvField(dto.activity),
        dto.status,
        dto.reviewedById ?? '',
      ])
    }
    let totalHours = 0
    for (const row of rows.slice(1)) {
      const hoursCell = row[4]
      if (typeof hoursCell === 'number') totalHours += hoursCell
    }
    rows.push(['', '', '', '', totalHours, 'TOTAL', '', ''])

    return rows
  }

  private escapeCsvField(value: string): string {
    const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n')
    if (!needsQuoting) return value
    return `"${value.replace(/"/g, '""')}"`
  }
}
