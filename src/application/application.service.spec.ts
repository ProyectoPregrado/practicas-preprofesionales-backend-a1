import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationService } from './application.service'

const prisma = {
  application: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  offer: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}
const offers = { acceptedCount: vi.fn() }

// La oferta 1 es de la empresa 5. `OWNER` trabaja en esa empresa, `FOREIGN` en otra.
const OWNER = 50
const FOREIGN = 60
const COMPANY_LESS = 70
const COORDINATOR = 99
const usersById: Record<number, { companyId: number | null }> = {
  [OWNER]: { companyId: 5 },
  [FOREIGN]: { companyId: 6 },
  [COMPANY_LESS]: { companyId: null },
}

describe('ApplicationService', () => {
  let service: ApplicationService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new ApplicationService(prisma as never, offers as never)
  })

  it('accepts an application when there are seats left', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED' })
    offers.acceptedCount.mockResolvedValue(2)
    prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data }))

    const result = await service.decide(7, 'ACCEPTED' as never, COORDINATOR, Role.COORDINATOR)

    expect(result.status).toBe('ACCEPTED')
    expect(result.decidedAt).toBeInstanceOf(Date)
  })

  it('rejects accepting when the offer is already full', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED' })
    offers.acceptedCount.mockResolvedValue(3)

    await expect(service.decide(7, 'ACCEPTED' as never, COORDINATOR, Role.COORDINATOR)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('lists applications of an offer with their student', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 1, studentId: 10, status: 'SUBMITTED' },
      { id: 2, studentId: 11, status: 'SUBMITTED' },
    ])
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 10, fullName: 'Estudiante 10' })
      .mockResolvedValueOnce({ id: 11, fullName: 'Estudiante 11' })

    const result = await service.listByOffer(1, COORDINATOR, Role.COORDINATOR)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 1, student: { fullName: 'Estudiante 10' } })
  })
})

// E3-07: la empresa solo ve y decide las postulaciones de sus propias ofertas.
describe('ApplicationService — pertenencia de la oferta (E3-07)', () => {
  let service: ApplicationService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new ApplicationService(prisma as never, offers as never)
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: 5, seats: 3, status: 'PUBLISHED' })
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'SUBMITTED' })
    prisma.application.findMany.mockResolvedValue([{ id: 1, studentId: 10, status: 'SUBMITTED' }])
    prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data }))
    offers.acceptedCount.mockResolvedValue(0)
    prisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(usersById[where.id] ?? { id: where.id, email: 'e@x', fullName: `Estudiante ${where.id}` }),
    )
  })

  describe('listByOffer', () => {
    it('lista las postulaciones a la empresa dueña de la oferta', async () => {
      const result = await service.listByOffer(1, OWNER, Role.COMPANY)

      expect(result).toHaveLength(1)
      expect(prisma.application.findMany).toHaveBeenCalledWith({ where: { offerId: 1 } })
    })

    it('rechaza con 403 a una empresa que no es dueña de la oferta, sin consultar las postulaciones', async () => {
      await expect(service.listByOffer(1, FOREIGN, Role.COMPANY)).rejects.toThrow(ForbiddenException)

      expect(prisma.application.findMany).not.toHaveBeenCalled()
    })

    it('lista las postulaciones a la coordinación sin resolver la empresa', async () => {
      const result = await service.listByOffer(1, COORDINATOR, Role.COORDINATOR)

      expect(result).toHaveLength(1)
      expect(prisma.offer.findUnique).not.toHaveBeenCalled()
    })

    it('rechaza a un usuario COMPANY sin empresa asociada', async () => {
      await expect(service.listByOffer(1, COMPANY_LESS, Role.COMPANY)).rejects.toThrow(ForbiddenException)
    })

    it.each([Role.STUDENT, Role.TUTOR])('rechaza al rol %s aunque llame al servicio directo', async (role) => {
      await expect(service.listByOffer(1, OWNER, role)).rejects.toThrow(ForbiddenException)

      expect(prisma.application.findMany).not.toHaveBeenCalled()
    })

    it('responde 404 si la oferta no existe', async () => {
      prisma.offer.findUnique.mockResolvedValue(null)

      await expect(service.listByOffer(999, OWNER, Role.COMPANY)).rejects.toThrow(NotFoundException)
    })
  })

  describe('decide', () => {
    it('permite decidir a la empresa dueña de la oferta', async () => {
      const result = await service.decide(7, ApplicationStatus.REJECTED, OWNER, Role.COMPANY)

      expect(result.status).toBe('REJECTED')
      expect(prisma.application.update).toHaveBeenCalledTimes(1)
    })

    it('rechaza con 403 a una empresa ajena, sin escribir ni contar cupos', async () => {
      await expect(service.decide(7, ApplicationStatus.ACCEPTED, FOREIGN, Role.COMPANY)).rejects.toThrow(
        ForbiddenException,
      )

      expect(prisma.application.update).not.toHaveBeenCalled()
      expect(offers.acceptedCount).not.toHaveBeenCalled()
    })

    it('responde 403 y no 400 a una empresa ajena aunque la postulación ya esté decidida', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'ACCEPTED' })

      await expect(service.decide(7, ApplicationStatus.REJECTED, FOREIGN, Role.COMPANY)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('permite decidir a la coordinación sin resolver la empresa', async () => {
      const result = await service.decide(7, ApplicationStatus.INTERVIEW, COORDINATOR, Role.COORDINATOR)

      expect(result.status).toBe('INTERVIEW')
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it.each([Role.STUDENT, Role.TUTOR])('rechaza al rol %s aunque llame al servicio directo', async (role) => {
      await expect(service.decide(7, ApplicationStatus.REJECTED, OWNER, role)).rejects.toThrow(ForbiddenException)

      expect(prisma.application.update).not.toHaveBeenCalled()
    })

    it('responde 404 si la postulación no existe', async () => {
      prisma.application.findUnique.mockResolvedValue(null)

      await expect(service.decide(999, ApplicationStatus.REJECTED, OWNER, Role.COMPANY)).rejects.toThrow(
        NotFoundException,
      )
    })

    // Regla 1 del Sprint 2: lo que dice "solo la dueña" se prueba también en paralelo, en los dos órdenes
    // de llegada, para que el resultado no dependa de quién se resuelve primero.
    it.each([
      ['la ajena llega primero', [FOREIGN, OWNER]],
      ['la dueña llega primero', [OWNER, FOREIGN]],
    ])('si una empresa ajena y la dueña deciden a la vez, solo la dueña escribe (%s)', async (_caso, order) => {
      const decisionOf: Record<number, ApplicationStatus> = {
        [FOREIGN]: ApplicationStatus.ACCEPTED,
        [OWNER]: ApplicationStatus.REJECTED,
      }

      const results = await Promise.allSettled(
        order.map((userId) => service.decide(7, decisionOf[userId], userId, Role.COMPANY)),
      )

      const byUser = Object.fromEntries(order.map((userId, i) => [userId, results[i]]))
      expect(byUser[FOREIGN].status).toBe('rejected')
      expect((byUser[FOREIGN] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException)
      expect(byUser[OWNER].status).toBe('fulfilled')
      expect(prisma.application.update).toHaveBeenCalledTimes(1)
      expect(prisma.application.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: ApplicationStatus.REJECTED }) }),
      )
    })

    it('si dos empresas ajenas deciden a la vez, ninguna escribe', async () => {
      const results = await Promise.allSettled([
        service.decide(7, ApplicationStatus.ACCEPTED, FOREIGN, Role.COMPANY),
        service.decide(7, ApplicationStatus.REJECTED, COMPANY_LESS, Role.COMPANY),
      ])

      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
      expect(prisma.application.update).not.toHaveBeenCalled()
    })
  })
})
