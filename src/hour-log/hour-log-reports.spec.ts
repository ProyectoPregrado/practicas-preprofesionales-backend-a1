import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogService } from './hour-log.service'
import { HourLogNotificationService } from './hour-log-notification.service'
import { HourLogReportService } from './hour-log-report.service'
import { HourLogExportService } from './hour-log-export.service'

// Caracterización de la API pública previa a E6-03: mismos resultados tras extraer servicios.
const prisma = {
  placement: { findUnique: vi.fn() },
  hourLog: { aggregate: vi.fn(), count: vi.fn(), findMany: vi.fn() },
}

const log = (overrides = {}) => ({
  id: 1, date: new Date('2026-04-01T12:00:00Z'), startTime: '08:00', endTime: '12:00',
  hours: 4, activity: 'Desarrollo', status: 'APPROVED', reviewedById: 7, ...overrides,
})

describe('E6-03 — contrato de reportes y exportación', () => {
  let service: HourLogService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new HourLogService(
      prisma as never,
      new HourLogNotificationService(),
      new HourLogReportService(prisma as never),
      new HourLogExportService(prisma as never),
    )
    prisma.placement.findUnique.mockResolvedValue({
      id: 1, requiredHours: 80, startDate: new Date('2026-04-01'), endDate: new Date('2026-04-15'),
    })
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 20 } })
    prisma.hourLog.count.mockResolvedValue(3)
    prisma.hourLog.findMany.mockResolvedValue([])
  })

  it('mantiene el avance y excluye registros borrados de las consultas', async () => {
    await expect(service.progressReport(1)).resolves.toEqual({
      placementId: 1, requiredHours: 80, approvedHours: 20, pendingLogs: 3, percentage: 25,
    })
    expect(prisma.hourLog.aggregate).toHaveBeenCalledWith({
      where: { placementId: 1, status: 'APPROVED', deletedAt: null }, _sum: { hours: true },
    })
    expect(prisma.hourLog.count).toHaveBeenCalledWith({
      where: { placementId: 1, status: 'SUBMITTED', deletedAt: null },
    })
  })

  it('devuelve cero si todavía no hay horas aprobadas', async () => {
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: null } })
    await expect(service.approvedHours(1)).resolves.toBe(0)
  })

  it('mantiene el 404 de los reportes para una plaza inexistente', async () => {
    prisma.placement.findUnique.mockResolvedValue(null)
    await expect(service.progressReport(99)).rejects.toThrow(NotFoundException)
    await expect(service.weeklySummary(99)).rejects.toThrow(NotFoundException)
  })

  it('agrupa semanas, ordena y solo cuenta APPROVED y SUBMITTED', async () => {
    prisma.hourLog.findMany.mockResolvedValue([
      log({ date: new Date('2026-04-08T12:00:00Z'), hours: 8 }),
      log(), log({ status: 'SUBMITTED', hours: 2 }),
      log({ status: 'DRAFT' }), log({ status: 'REJECTED' }),
    ])
    await expect(service.weeklySummary(1)).resolves.toEqual([
      { week: '2026-W14', approvedHours: 4, submittedHours: 2, logsCount: 2, expectedHoursPercentage: 10 },
      { week: '2026-W15', approvedHours: 8, submittedHours: 0, logsCount: 1, expectedHoursPercentage: 20 },
    ])
    expect(prisma.hourLog.findMany).toHaveBeenCalledWith({
      where: { placementId: 1, deletedAt: null }, orderBy: { date: 'asc' },
    })
  })

  it('conserva la semana ISO en el cambio de año y el mínimo de una semana', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      requiredHours: 8, startDate: new Date('2021-01-01'), endDate: new Date('2021-01-01'),
    })
    prisma.hourLog.findMany.mockResolvedValue([log({ date: new Date('2021-01-01T12:00:00Z') })])
    await expect(service.weeklySummary(1)).resolves.toEqual([
      { week: '2020-W53', approvedHours: 4, submittedHours: 0, logsCount: 1, expectedHoursPercentage: 50 },
    ])
  })

  it('conserva encabezado, escape de CSV, revisor vacío y total de todos los estados', async () => {
    prisma.hourLog.findMany.mockResolvedValue([
      log({ activity: 'Informe, "final"\nsegunda línea' }),
      log({ id: 2, hours: 2, status: 'REJECTED', reviewedById: null }),
    ])
    await expect(service.exportRows(1)).resolves.toEqual([
      ['id', 'fecha', 'inicio', 'fin', 'horas', 'actividad', 'estado', 'revisadoPor'],
      [1, '2026-04-01', '08:00', '12:00', 4, '"Informe, ""final""\nsegunda línea"', 'APPROVED', 7],
      [2, '2026-04-01', '08:00', '12:00', 2, 'Desarrollo', 'REJECTED', ''],
      ['', '', '', '', 6, 'TOTAL', '', ''],
    ])
  })

  it('exporta encabezado y total cero cuando el libro está vacío', async () => {
    const rows = await service.exportRows(1)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['', '', '', '', 0, 'TOTAL', '', ''])
    await expect(service.weeklySummary(1)).resolves.toEqual([])
  })

  it.each([
    { hours: 9 }, { hours: 0 }, { startTime: '12:00', endTime: '08:00' },
  ])('mantiene la validación de registros históricos al exportar %j', async (invalid) => {
    prisma.hourLog.findMany.mockResolvedValue([log(invalid)])
    await expect(service.exportRows(1)).rejects.toThrow(BadRequestException)
  })
})
