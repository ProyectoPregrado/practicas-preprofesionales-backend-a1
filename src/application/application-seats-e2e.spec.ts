import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ApplicationStatus, OfferStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { ApplicationService } from './application.service'

// E2-01 — Demuestra el sobrecupo contra Postgres real.
//
// `decide` lee cuántas postulaciones hay aceptadas (application.service.ts:76) y después escribe
// (application.service.ts:80). Entre las dos líneas hay una ventana. Para no depender de la suerte
// del planificador, la barrera de abajo deja que las dos llamadas LEAN antes de que cualquiera
// ESCRIBA: es el peor intercalado posible, y lo fuerza siempre.

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

async function createOfferWithTwoCandidates() {
  const offer = await prisma.offer.create({
    data: {
      companyId,
      title: `E2-01 ${suffix}`,
      description: 'oferta de prueba de concurrencia',
      modality: 'PRESENCIAL',
      seats: 1,
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

describe('E2-01 — sobrecupo con dos aceptaciones simultáneas (documenta el bug actual)', () => {
  it.each([1, 2, 3])(
    'repetición %i: con UNA plaza libre, las dos aceptaciones pasan y la oferta queda con 2 aceptadas',
    async () => {
      const { offerId, applicationIds } = await createOfferWithTwoCandidates()

      const { results, accepted } = await acceptBoth(offerId, applicationIds)

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(accepted).toBe(2)
    },
  )

  // La invariante que E2-02 tiene que garantizar. Hoy FALLA (por eso `it.fails`: la CI sigue en verde
  // y queda registrado que el fallo es real). E2-02 lo convierte en un `it` normal.
  it.fails('la invariante "aceptadas <= cupos" se cumple', async () => {
    const { offerId, applicationIds } = await createOfferWithTwoCandidates()

    const { accepted } = await acceptBoth(offerId, applicationIds)

    expect(accepted).toBeLessThanOrEqual(1)
  })
})
