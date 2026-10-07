import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfferService } from './offer.service'

const prisma = {
  offer: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  application: { count: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}

// La oferta 1 es de la empresa 5. `OWNER` trabaja en esa empresa y `FOREIGN` en otra.
const OWNER = 50
const FOREIGN = 60
const COMPANY_LESS = 70
const COORDINATOR = 99
const STUDENT = 10
const TUTOR = 80
const OFFER_COMPANY = 5
const usersById: Record<number, { companyId: number | null }> = {
  [OWNER]: { companyId: OFFER_COMPANY },
  [FOREIGN]: { companyId: 6 },
  [COMPANY_LESS]: { companyId: null },
}

const dto = (companyId: number) =>
  ({
    companyId,
    title: 'Oferta',
    description: 'x',
    modality: 'PRESENCIAL',
    seats: 1,
    requiredHours: 240,
    periodStart: new Date('2026-03-01'),
    periodEnd: new Date('2026-07-31'),
  }) as never

describe('OfferService', () => {
  let service: OfferService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new OfferService(prisma as never)
  })

  it('publishes a DRAFT offer and stamps publishedAt', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, status: 'DRAFT' })
    prisma.offer.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

    const result = await service.publish(1, COORDINATOR, Role.COORDINATOR)

    expect(result.status).toBe('PUBLISHED')
    expect(result.publishedAt).toBeInstanceOf(Date)
  })

  it('rejects publishing an offer that is not DRAFT', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, status: 'CLOSED' })

    await expect(service.publish(1, COORDINATOR, Role.COORDINATOR)).rejects.toThrow(BadRequestException)
  })

  it('counts accepted applications for an offer', async () => {
    prisma.application.count.mockResolvedValue(3)

    await expect(service.acceptedCount(1)).resolves.toBe(3)
    expect(prisma.application.count).toHaveBeenCalledWith({
      where: { offerId: 1, status: 'ACCEPTED' },
    })
  })

  it('lists all offers of the company tied to the authenticated user, any status', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 7 })
    prisma.offer.findMany.mockResolvedValue([{ id: 1, companyId: 7, status: 'DRAFT' }])

    const result = await service.findAllForCompanyUser(42)

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 42 }, select: { companyId: true } })
    expect(prisma.offer.findMany).toHaveBeenCalledWith({
      where: { companyId: 7 },
      orderBy: { createdAt: 'desc' },
      include: { company: true, applications: { select: { status: true } } },
    })
    expect(result).toEqual([{ id: 1, companyId: 7, status: 'DRAFT' }])
  })

  it('rejects listing offers for a user with no company', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: null })

    await expect(service.findAllForCompanyUser(42)).rejects.toThrow('el usuario no tiene una empresa asociada')
  })
})

// E3-01 / H-4 (issue #13): crear, publicar y cerrar solo ofertas de la propia empresa.
describe('OfferService — pertenencia de la empresa (H-4)', () => {
  let service: OfferService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new OfferService(prisma as never)
    prisma.offer.create.mockImplementation(({ data }) => Promise.resolve({ id: 100, ...data }))
    prisma.offer.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))
    prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(usersById[where.id] ?? null))
  })

  describe('create', () => {
    it('crea la oferta en DRAFT cuando la empresa usa su propio companyId', async () => {
      const result = await service.create(dto(OFFER_COMPANY), OWNER, Role.COMPANY)

      expect(result.status).toBe('DRAFT')
      expect(prisma.offer.create).toHaveBeenCalledTimes(1)
    })

    it('rechaza con 403 a una empresa que manda el companyId de otra, sin crear nada', async () => {
      await expect(service.create(dto(OFFER_COMPANY), FOREIGN, Role.COMPANY)).rejects.toThrow(ForbiddenException)

      expect(prisma.offer.create).not.toHaveBeenCalled()
    })

    it('permite a la coordinación crear a nombre de cualquier empresa, sin resolver la suya', async () => {
      await service.create(dto(OFFER_COMPANY), COORDINATOR, Role.COORDINATOR)

      expect(prisma.offer.create).toHaveBeenCalledTimes(1)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('rechaza a un usuario COMPANY sin empresa asociada', async () => {
      await expect(service.create(dto(OFFER_COMPANY), COMPANY_LESS, Role.COMPANY)).rejects.toThrow(ForbiddenException)
    })

    it.each([Role.STUDENT, Role.TUTOR])('rechaza al rol %s aunque llame al servicio directo', async (role) => {
      await expect(service.create(dto(OFFER_COMPANY), OWNER, role)).rejects.toThrow(ForbiddenException)

      expect(prisma.offer.create).not.toHaveBeenCalled()
    })

    // Regla 1 del Sprint 2: "solo la dueña" también se prueba en paralelo.
    it('si la dueña y una empresa ajena crean a la vez con el mismo companyId, solo la dueña escribe', async () => {
      const results = await Promise.allSettled([
        service.create(dto(OFFER_COMPANY), FOREIGN, Role.COMPANY),
        service.create(dto(OFFER_COMPANY), OWNER, Role.COMPANY),
      ])

      expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled'])
      expect((results[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException)
      expect(prisma.offer.create).toHaveBeenCalledTimes(1)
    })
  })

  describe.each([
    { name: 'publish', from: 'DRAFT', to: 'PUBLISHED', wrongState: 'CLOSED' },
    { name: 'close', from: 'PUBLISHED', to: 'CLOSED', wrongState: 'DRAFT' },
  ] as const)('$name', ({ name, from, to, wrongState }) => {
    const call = (userId: number, role: Role) => service[name](1, userId, role)

    beforeEach(() => {
      prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: OFFER_COMPANY, status: from })
    })

    it('lo permite a la empresa dueña', async () => {
      const result = await call(OWNER, Role.COMPANY)

      expect(result.status).toBe(to)
      expect(prisma.offer.update).toHaveBeenCalledTimes(1)
    })

    it('rechaza con 403 a una empresa ajena, sin escribir', async () => {
      await expect(call(FOREIGN, Role.COMPANY)).rejects.toThrow(ForbiddenException)

      expect(prisma.offer.update).not.toHaveBeenCalled()
    })

    it('responde 403 y no 400 a una empresa ajena aunque la oferta esté en otro estado', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: OFFER_COMPANY, status: wrongState })

      await expect(call(FOREIGN, Role.COMPANY)).rejects.toThrow(ForbiddenException)
    })

    it('lo permite a la coordinación, sin resolver la empresa', async () => {
      const result = await call(COORDINATOR, Role.COORDINATOR)

      expect(result.status).toBe(to)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it.each([Role.STUDENT, Role.TUTOR])('rechaza al rol %s aunque llame al servicio directo', async (role) => {
      await expect(call(OWNER, role)).rejects.toThrow(ForbiddenException)

      expect(prisma.offer.update).not.toHaveBeenCalled()
    })

    it('responde 404 si la oferta no existe', async () => {
      prisma.offer.findUnique.mockResolvedValue(null)

      await expect(call(OWNER, Role.COMPANY)).rejects.toThrow(NotFoundException)
    })

    it.each([
      ['la ajena llega primero', [FOREIGN, OWNER]],
      ['la dueña llega primero', [OWNER, FOREIGN]],
    ])('si la dueña y una empresa ajena lo piden a la vez, solo la dueña escribe (%s)', async (_caso, order) => {
      const results = await Promise.allSettled(order.map((userId) => call(userId, Role.COMPANY)))

      const byUser = Object.fromEntries(order.map((userId, i) => [userId, results[i]]))
      expect(byUser[FOREIGN].status).toBe('rejected')
      expect((byUser[FOREIGN] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException)
      expect(byUser[OWNER].status).toBe('fulfilled')
      expect(prisma.offer.update).toHaveBeenCalledTimes(1)
    })
  })
})

// E3-01 / H-5 (issue #14): un borrador o una oferta cerrada no se filtran a quien no corresponde.
describe('OfferService — visibilidad de una oferta (H-5)', () => {
  let service: OfferService

  const offerWith = (status: string) => ({ id: 1, companyId: OFFER_COMPANY, status, company: { id: OFFER_COMPANY } })

  beforeEach(() => {
    vi.resetAllMocks()
    service = new OfferService(prisma as never)
    prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(usersById[where.id] ?? null))
    prisma.application.findFirst.mockResolvedValue(null)
  })

  it.each([Role.STUDENT, Role.TUTOR, Role.COMPANY, Role.COORDINATOR])(
    'una oferta publicada la ve el rol %s, sin consultas extra',
    async (role) => {
      prisma.offer.findUnique.mockResolvedValue(offerWith('PUBLISHED'))

      const result = await service.findOne(1, FOREIGN, role)

      expect(result.id).toBe(1)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
      expect(prisma.application.findFirst).not.toHaveBeenCalled()
    },
  )

  describe.each(['DRAFT', 'CLOSED'])('oferta en %s', (status) => {
    beforeEach(() => {
      prisma.offer.findUnique.mockResolvedValue(offerWith(status))
    })

    it('la ve la empresa dueña', async () => {
      await expect(service.findOne(1, OWNER, Role.COMPANY)).resolves.toMatchObject({ id: 1 })
    })

    it('la ve la coordinación', async () => {
      await expect(service.findOne(1, COORDINATOR, Role.COORDINATOR)).resolves.toMatchObject({ id: 1 })
    })

    it('responde 404 a otra empresa', async () => {
      await expect(service.findOne(1, FOREIGN, Role.COMPANY)).rejects.toThrow(NotFoundException)
    })

    it('responde 404 a un usuario COMPANY sin empresa asociada', async () => {
      await expect(service.findOne(1, COMPANY_LESS, Role.COMPANY)).rejects.toThrow(NotFoundException)
    })

    it('responde 404 a un estudiante que no se postuló, y no un 403 que revele que existe', async () => {
      await expect(service.findOne(1, STUDENT, Role.STUDENT)).rejects.toThrow(NotFoundException)
      expect(prisma.application.findFirst).toHaveBeenCalledWith({
        where: { offerId: 1, studentId: STUDENT },
        select: { id: true },
      })
    })

    it('la ve el estudiante que ya se postuló a ella', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: 7 })

      await expect(service.findOne(1, STUDENT, Role.STUDENT)).resolves.toMatchObject({ id: 1 })
    })

    it('responde 404 a un tutor', async () => {
      await expect(service.findOne(1, TUTOR, Role.TUTOR)).rejects.toThrow(NotFoundException)
    })
  })

  it('responde 404 si la oferta no existe', async () => {
    prisma.offer.findUnique.mockResolvedValue(null)

    await expect(service.findOne(999, STUDENT, Role.STUDENT)).rejects.toThrow(NotFoundException)
  })
})
