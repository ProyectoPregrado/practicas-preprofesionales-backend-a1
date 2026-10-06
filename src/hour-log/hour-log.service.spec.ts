import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogService } from './hour-log.service'

const prisma = {
  hourLog: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
  placement: { findUnique: vi.fn() },
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

    const result = await service.create(
      { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollo de módulo de reportes' },
      5,
    )

    expect(result.status).toBe('SUBMITTED')
    expect(result.hours).toBe(4)
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
})
