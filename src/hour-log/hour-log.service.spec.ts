import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIME_ZONES, useTimeZone } from '../test/time-zone'
import { HourLogService } from './hour-log.service'

const prisma = {
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  $executeRaw: vi.fn(),
  hourLog: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
  placement: { findUnique: vi.fn(), updateMany: vi.fn() },
}

describe('HourLogService', () => {
  let service: HourLogService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new HourLogService(prisma as never)
  })

  it('creates an hour log in SUBMITTED for an active placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 0 } })

    const result = await service.create(
      { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollo de módulo de reportes' },
      5,
    )

    expect(result.status).toBe('SUBMITTED')
    expect(result.hours).toBe(4)
  })

  // E6-01: el tope es 8 horas por día, sumando todos los registros del estudiante en esa fecha.
  describe('E6-01 — tope de horas por día', () => {
    const dto = (hours: number) => ({
      placementId: 1,
      date: new Date('2026-04-01'),
      startTime: '08:00',
      endTime: '18:00',
      hours,
      activity: 'Jornada de práctica',
    })

    beforeEach(() => {
      prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
      prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 0 } })
    })

    it('acepta un registro de exactamente 8 horas', async () => {
      await expect(service.create(dto(8), 5)).resolves.toMatchObject({ hours: 8 })
    })

    it('rechaza un registro de 8.5 horas con el mensaje del rango', async () => {
      await expect(service.create(dto(8.5), 5)).rejects.toThrow(/entre 0\.5 y 8/)
      expect(prisma.hourLog.create).not.toHaveBeenCalled()
    })

    it('rechaza si, sumado a lo ya registrado ese día, pasa de 8 horas', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 6 } })

      await expect(service.create(dto(3), 5)).rejects.toThrow(/no puede superar 8 horas \(ya tienes 6 registradas el 2026-04-01\)/)
      expect(prisma.hourLog.create).not.toHaveBeenCalled()
    })

    it('permite completar el día justo en 8 horas (6 ya registradas + 2)', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 6 } })

      await expect(service.create(dto(2), 5)).resolves.toMatchObject({ hours: 2 })
    })

    it('valida y escribe dentro del bloqueo por estudiante', async () => {
      await service.create(dto(2), 5)

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects an hour log with more hours than the service allows', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })

    await expect(
      service.create(
        { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '20:00', hours: 11, activity: 'Jornada larga de soporte' },
        5,
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('approves a submitted hour log', async () => {
    prisma.placement.findUnique.mockResolvedValue({ requiredHours: 240, status: 'ACTIVE' })
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 4 } })
    prisma.hourLog.findUnique
      .mockResolvedValueOnce({
        id: 99,
        placementId: 1,
        status: 'SUBMITTED',
        version: 1,
        placement: { tutorId: 7 },
      })
      .mockResolvedValueOnce({ id: 99, status: 'APPROVED', reviewedById: 7 })
    prisma.hourLog.updateMany.mockResolvedValue({ count: 1 })

    const result = await service.review(99, 'APPROVED' as never, 7, 'ok')

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(7)
    expect(prisma.hourLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 99,
          status: 'SUBMITTED',
          placement: { tutorId: 7 },
        },
      }),
    )
  })

  it('rejects a tutor who attempts to review hours from another placement', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { tutorId: 7 },
    })

    await expect(service.review(99, 'APPROVED' as never, 8, 'no corresponde')).rejects.toThrow(
      ForbiddenException,
    )
    expect(prisma.hourLog.updateMany).not.toHaveBeenCalled()
  })

  it('E3-02: only the assigned tutor wins when two tutors review concurrently', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { tutorId: 7 },
    })
    prisma.hourLog.updateMany.mockResolvedValue({ count: 1 })

    const [ownerResult] = await Promise.all([
      service.review(99, 'APPROVED' as never, 7, 'aprobado por el tutor asignado'),
      expect(service.review(99, 'REJECTED' as never, 8, 'tutor ajeno')).rejects.toThrow(ForbiddenException),
    ])

    expect(ownerResult).toMatchObject({ id: 99 })
    expect(prisma.hourLog.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.hourLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ placement: { tutorId: 7 } }) }),
    )
  })

  // N-3: la plaza se completa al alcanzar requiredHours, bajo el bloqueo por plaza.
  describe('N-3 — plaza COMPLETED al aprobar horas', () => {
    beforeEach(() => {
      prisma.hourLog.findUnique
        .mockReset()
        .mockResolvedValueOnce({ id: 99, placementId: 1, status: 'SUBMITTED', version: 1, placement: { tutorId: 7 } })
        .mockResolvedValue({ id: 99, status: 'APPROVED', reviewedById: 7 })
      prisma.hourLog.updateMany.mockResolvedValue({ count: 1 })
      prisma.placement.findUnique.mockResolvedValue({ requiredHours: 240, status: 'ACTIVE' })
      prisma.placement.updateMany.mockResolvedValue({ count: 1 })
    })

    it('al aprobar completa la plaza si las horas aprobadas alcanzan requiredHours', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 240 } })

      await service.review(99, 'APPROVED' as never, 7)

      expect(prisma.placement.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'ACTIVE' },
        data: { status: 'COMPLETED', version: { increment: 1 } },
      })
    })

    it('toma el bloqueo de la plaza antes de escribir la aprobación', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 1 } })

      await service.review(99, 'APPROVED' as never, 7)

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.hourLog.updateMany.mock.invocationCallOrder[0])
    })

    it('no completa la plaza por debajo del umbral', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 239.5 } })

      await service.review(99, 'APPROVED' as never, 7)

      expect(prisma.placement.updateMany).not.toHaveBeenCalled()
    })

    it('rechazar horas no evalúa ni completa la plaza', async () => {
      await service.review(99, 'REJECTED' as never, 7, 'no cuadra')

      expect(prisma.hourLog.aggregate).not.toHaveBeenCalled()
      expect(prisma.placement.updateMany).not.toHaveBeenCalled()
    })

    it('si la revisión pierde la carrera (count 0) no completa la plaza', async () => {
      prisma.hourLog.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.review(99, 'APPROVED' as never, 7)).rejects.toThrow(BadRequestException)
      expect(prisma.placement.updateMany).not.toHaveBeenCalled()
    })
  })
})

// E6-02: la semana ISO sale del día calendario guardado (medianoche UTC), no de la zona del servidor.
describe.each(TIME_ZONES)('HourLogService.weeklySummary — semana ISO (E6-02), zona %s', (zone) => {
  useTimeZone(zone)
  let service: HourLogService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new HourLogService(prisma as never)
    prisma.placement.findUnique.mockResolvedValue({
      id: 1,
      requiredHours: 240,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-01-31'),
    })
  })

  const weeksOf = async (dates: string[]) => {
    prisma.hourLog.findMany.mockResolvedValue(
      dates.map((date, i) => ({ id: i + 1, date: new Date(date), hours: 4, status: 'APPROVED' })),
    )
    return (await service.weeklySummary(1)).map((row) => [row.week, row.logsCount])
  }

  it('un lunes y el domingo siguiente caen en la misma semana', async () => {
    expect(await weeksOf(['2026-03-02', '2026-03-08'])).toEqual([['2026-W10', 2]])
  })

  it('el lunes siguiente abre la semana siguiente', async () => {
    expect(await weeksOf(['2026-03-08', '2026-03-09'])).toEqual([
      ['2026-W10', 1],
      ['2026-W11', 1],
    ])
  })

  it('respeta el borde de año: 2026-12-31 y 2027-01-01 son de la 2026-W53', async () => {
    expect(await weeksOf(['2026-12-31', '2027-01-01'])).toEqual([['2026-W53', 2]])
  })
})
