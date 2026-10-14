import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_COMPANY_SELECT } from '../company/company.select'
import { ApplicationService } from './application.service'

const prisma = {
  application: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  offer: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}
const offers = { acceptedCount: vi.fn() }

// El UPDATE de `decide` es condicional (`updateMany`): el mock lo da por ganado y deja leer lo escrito.
function mockWriteWins() {
  let written: Record<string, unknown> = {}
  prisma.application.updateMany.mockImplementation(({ data }) => {
    written = data
    return Promise.resolve({ count: 1 })
  })
  prisma.application.findUniqueOrThrow.mockImplementation(() => Promise.resolve({ id: 7, ...written }))
}

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
    mockWriteWins()

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

  it('loads 200 candidates without a lookup per student', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1, studentId: i + 10, status: 'SUBMITTED',
      student: { id: i + 10, email: 'student@test.invalid', fullName: 'Student' },
    }))
    prisma.application.findMany.mockResolvedValue(rows)
    prisma.user.findUnique.mockResolvedValue(rows[0].student)

    const result = await service.listByOffer(1, COORDINATOR, Role.COORDINATOR)

    console.info('E2-03 ORM calls for 200 candidates:',
      prisma.application.findMany.mock.calls.length + prisma.user.findUnique.mock.calls.length)
    expect(result).toHaveLength(200)
    expect(prisma.user.findUnique.mock.calls.length).toBe(0)
  })

  it('lists applications of an offer with their student', async () => {
    const rows = [
      { id: 1, studentId: 10, status: 'SUBMITTED', student: { id: 10, fullName: 'Estudiante 10', email: 's10@test.invalid' } },
      { id: 2, studentId: 11, status: 'SUBMITTED', student: { id: 11, fullName: 'Estudiante 11', email: 's11@test.invalid' } },
    ]
    prisma.application.findMany.mockResolvedValue(rows)

    const result = await service.listByOffer(1, COORDINATOR, Role.COORDINATOR)

    expect(result).toEqual(rows)
    expect(prisma.application.findMany).toHaveBeenCalledWith({
      where: { offerId: 1 },
      include: { student: { select: { id: true, email: true, fullName: true } } },
    })
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
    mockWriteWins()
    offers.acceptedCount.mockResolvedValue(0)
    prisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(usersById[where.id] ?? { id: where.id, email: 'e@x', fullName: `Estudiante ${where.id}` }),
    )
  })

  describe('listByOffer', () => {
    it('lista las postulaciones a la empresa dueña de la oferta', async () => {
      const result = await service.listByOffer(1, OWNER, Role.COMPANY)

      expect(result).toHaveLength(1)
      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { offerId: 1 } }))
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
      expect(prisma.application.updateMany).toHaveBeenCalledTimes(1)
    })

    it('rechaza con 403 a una empresa ajena, sin escribir ni contar cupos', async () => {
      await expect(service.decide(7, ApplicationStatus.ACCEPTED, FOREIGN, Role.COMPANY)).rejects.toThrow(
        ForbiddenException,
      )

      expect(prisma.application.updateMany).not.toHaveBeenCalled()
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

      expect(prisma.application.updateMany).not.toHaveBeenCalled()
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
      expect(prisma.application.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.application.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: ApplicationStatus.REJECTED }) }),
      )
    })

    describe('decisiones simultáneas sobre la misma postulación', () => {
      it('el UPDATE queda condicionado al estado vigente (SUBMITTED o INTERVIEW)', async () => {
        await service.decide(7, ApplicationStatus.REJECTED, COORDINATOR, Role.COORDINATOR)

        expect(prisma.application.updateMany).toHaveBeenCalledWith({
          where: { id: 7, status: { in: [ApplicationStatus.SUBMITTED, ApplicationStatus.INTERVIEW] } },
          data: expect.objectContaining({ status: ApplicationStatus.REJECTED }),
        })
      })

      it('si otra decisión ganó entre la lectura y la escritura (count 0), recibe "ya fue decidida"', async () => {
        prisma.application.updateMany.mockResolvedValue({ count: 0 })

        const error = await service
          .decide(7, ApplicationStatus.REJECTED, COORDINATOR, Role.COORDINATOR)
          .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(BadRequestException)
        expect((error as BadRequestException).message).toBe('la postulación ya fue decidida')
        expect(prisma.application.findUniqueOrThrow).not.toHaveBeenCalled()
      })

      it('devuelve la postulación ya actualizada leída de la base', async () => {
        prisma.application.updateMany.mockResolvedValue({ count: 1 })
        prisma.application.findUniqueOrThrow.mockResolvedValue({ id: 7, offerId: 1, status: 'REJECTED' })

        await expect(service.decide(7, ApplicationStatus.REJECTED, COORDINATOR, Role.COORDINATOR)).resolves.toEqual({
          id: 7,
          offerId: 1,
          status: 'REJECTED',
        })
        expect(prisma.application.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 7 } })
      })

      it('traduce offer_full del trigger al mismo error de cupos del chequeo previo', async () => {
        prisma.application.updateMany.mockRejectedValue(new Error('offer_full: la oferta 1 ya no tiene cupos'))

        const error = await service
          .decide(7, ApplicationStatus.ACCEPTED, COORDINATOR, Role.COORDINATOR)
          .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(BadRequestException)
        expect((error as BadRequestException).message).toBe('la oferta ya no tiene cupos')
      })

      it('una postulación ya decidida al leerla falla antes de escribir', async () => {
        prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'REJECTED' })

        await expect(service.decide(7, ApplicationStatus.ACCEPTED, COORDINATOR, Role.COORDINATOR)).rejects.toThrow(
          'la postulación ya fue decidida',
        )
        expect(prisma.application.updateMany).not.toHaveBeenCalled()
      })
    })

    it('si dos empresas ajenas deciden a la vez, ninguna escribe', async () => {
      const results = await Promise.allSettled([
        service.decide(7, ApplicationStatus.ACCEPTED, FOREIGN, Role.COMPANY),
        service.decide(7, ApplicationStatus.REJECTED, COMPANY_LESS, Role.COMPANY),
      ])

      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
      expect(prisma.application.updateMany).not.toHaveBeenCalled()
    })
  })
})

// H-6 (T-4): las postulaciones propias traen la empresa sin NIT ni correo de contacto.
describe('ApplicationService — datos públicos de la empresa (H-6)', () => {
  it('listForStudent incluye solo los campos públicos de la empresa', async () => {
    vi.resetAllMocks()
    prisma.application.findMany.mockResolvedValue([])
    const service = new ApplicationService(prisma as never, offers as never)

    await service.listForStudent(10)

    expect(prisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { offer: { include: { company: { select: PUBLIC_COMPANY_SELECT } } } },
      }),
    )
  })
})
