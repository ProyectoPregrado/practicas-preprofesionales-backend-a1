import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { ApplicationStatus, OfferStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { ApplicationService } from './application.service'

// E2-01 / E2-02 — Integridad de cupos contra Postgres real.
//
// `decide` lee cuántas postulaciones hay aceptadas y después escribe: entre las dos operaciones hay
// una ventana (E2-01). Para no depender de la suerte del planificador, la barrera de abajo deja que
// las dos llamadas LEAN antes de que cualquiera ESCRIBA: es el peor intercalado posible, y lo fuerza
// siempre. E2-02 cierra la ventana en la base (trigger `enforce_offer_seats`), no en el código.

class Barrier {
  private arrived = 0
  private release!: () => void
  private readonly opened = new Promise<void>((resolve) => {
    this.release = resolve
  })

  constructor(private readonly parties: number) {}

  async arrive(): Promise<void> {
    this.arrived += 1
    if (this.arrived >= this.parties) this.release()
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('la barrera no se abrió: una llamada no llegó a leer')), 5000),
    )
    await Promise.race([this.opened, timeout])
  }
}

class BarrierOfferService extends OfferService {
  constructor(
    prisma: PrismaClient,
    private readonly barrier: Barrier,
  ) {
    super(prisma as never)
  }

  override async acceptedCount(offerId: number): Promise<number> {
    const count = await super.acceptedCount(offerId)
    await this.barrier.arrive()
    return count
  }
}

const prisma = new PrismaClient()
const suffix = `${Date.now()}`
const createdUserIds: number[] = []
let companyId = 0

async function createOfferWithTwoCandidates(seats = 1) {
  const offer = await prisma.offer.create({
    data: {
      companyId,
      title: `E2-01 ${suffix}`,
      description: 'oferta de prueba de concurrencia',
      modality: 'PRESENCIAL',
      seats,
      requiredHours: 240,
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-07-31'),
      status: OfferStatus.PUBLISHED,
    },
  })
  const applicationIds: number[] = []
  for (const n of [1, 2]) {
    const student = await prisma.user.create({
      data: {
        email: `e2-01-${suffix}-${offer.id}-${n}@test.local`,
        password: randomUUID(),
        fullName: `Candidato ${n}`,
        role: Role.STUDENT,
      },
    })
    createdUserIds.push(student.id)
    const application = await prisma.application.create({
      data: { offerId: offer.id, studentId: student.id, motivation: 'm'.repeat(24), status: ApplicationStatus.SUBMITTED },
    })
    applicationIds.push(application.id)
  }
  return { offerId: offer.id, applicationIds }
}

async function acceptBoth(offerId: number, applicationIds: number[]) {
  const service = new ApplicationService(prisma as never, new BarrierOfferService(prisma, new Barrier(2)) as never)
  const results = await Promise.allSettled(
    applicationIds.map((id) => service.decide(id, ApplicationStatus.ACCEPTED, 0, Role.COORDINATOR)),
  )
  const accepted = await prisma.application.count({ where: { offerId, status: ApplicationStatus.ACCEPTED } })
  return { results, accepted }
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `E201${suffix}`, name: `Empresa E2-01 ${suffix}`, sector: 'TI', contactEmail: `e201-${suffix}@test.local` },
  })
  companyId = company.id
})

afterAll(async () => {
  const offers = await prisma.offer.findMany({ where: { companyId }, select: { id: true } })
  const offerIds = offers.map((o) => o.id)
  await prisma.application.deleteMany({ where: { offerId: { in: offerIds } } })
  await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await prisma.company.delete({ where: { id: companyId } })
  await prisma.$disconnect()
})

describe('E2-02 — nunca se aceptan más postulaciones que cupos', () => {
  it.each([1, 2, 3])(
    'repetición %i: con UNA plaza libre y dos aceptaciones simultáneas, exactamente una tiene éxito',
    async () => {
      const { offerId, applicationIds } = await createOfferWithTwoCandidates(1)

      const { results, accepted } = await acceptBoth(offerId, applicationIds)

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(accepted).toBe(1)
    },
  )

  it('la que pierde recibe un error claro que explica que la oferta se llenó, no un fallo genérico', async () => {
    const { offerId, applicationIds } = await createOfferWithTwoCandidates(1)

    const { results } = await acceptBoth(offerId, applicationIds)

    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(BadRequestException)
    expect((rejected?.reason as BadRequestException).message).toBe('la oferta ya no tiene cupos')
  })

  it('aceptar sigue funcionando con cupos de sobra: con 2 plazas pasan las dos', async () => {
    const { offerId, applicationIds } = await createOfferWithTwoCandidates(2)

    const { results, accepted } = await acceptBoth(offerId, applicationIds)

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(accepted).toBe(2)
  })

  it('la garantía no depende del código de aplicación: la base rechaza el UPDATE directo', async () => {
    const { offerId, applicationIds } = await createOfferWithTwoCandidates(1)
    await prisma.application.update({ where: { id: applicationIds[0] }, data: { status: ApplicationStatus.ACCEPTED } })

    // Se salta ApplicationService y OfferService: va directo a la tabla.
    await expect(
      prisma.application.update({ where: { id: applicationIds[1] }, data: { status: ApplicationStatus.ACCEPTED } }),
    ).rejects.toThrow(/offer_full/)

    expect(await prisma.application.count({ where: { offerId, status: ApplicationStatus.ACCEPTED } })).toBe(1)
  })

  it('una aceptada que sigue aceptada no se bloquea al volver a escribirse (ofertas ya llenas)', async () => {
    const { applicationIds } = await createOfferWithTwoCandidates(1)
    await prisma.application.update({ where: { id: applicationIds[0] }, data: { status: ApplicationStatus.ACCEPTED } })

    await expect(
      prisma.application.update({ where: { id: applicationIds[0] }, data: { decidedAt: new Date() } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.ACCEPTED })
  })

  it('liberar un cupo lo vuelve a dejar disponible: rechazar a la aceptada permite aceptar a la otra', async () => {
    const { applicationIds } = await createOfferWithTwoCandidates(1)
    await prisma.application.update({ where: { id: applicationIds[0] }, data: { status: ApplicationStatus.ACCEPTED } })
    await prisma.application.update({ where: { id: applicationIds[0] }, data: { status: ApplicationStatus.WITHDRAWN } })

    await expect(
      prisma.application.update({ where: { id: applicationIds[1] }, data: { status: ApplicationStatus.ACCEPTED } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.ACCEPTED })
  })
})
