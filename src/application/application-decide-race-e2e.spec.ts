import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { ApplicationStatus, OfferStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApplicationService } from './application.service'

// Carrera en `decide` sobre la MISMA postulación, contra Postgres real.
//
// `decide` lee el estado de la postulación, valida y escribe. Si dos decisiones llegan a la vez, las
// dos pueden pasar el chequeo de estado y las dos escribir: gana la última y la primera cree que
// decidió. La barrera de abajo fuerza el peor intercalado (las dos LEEN antes de que cualquiera
// ESCRIBA), sin sleeps. La exclusividad la da la base: el UPDATE queda condicionado al estado vigente.

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

const prisma = new PrismaClient()
const suffix = `${Date.now()}`
const createdUserIds: number[] = []
let companyId = 0

// Igual que el cliente real, salvo que cada `findUnique` de postulación espera en la barrera DESPUÉS
// de leer: ninguna decisión escribe hasta que las dos ya vieron el estado inicial.
function prismaWithReadBarrier(barrier: Barrier) {
  const application = new Proxy(prisma.application, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'findUnique') {
        return async (args: never) => {
          const row = await (value as (a: never) => Promise<unknown>).call(target, args)
          await barrier.arrive()
          return row
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === 'application') return application
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function createSubmittedApplication(initial: ApplicationStatus) {
  const offer = await prisma.offer.create({
    data: {
      companyId,
      title: `Carrera decide ${suffix}`,
      description: 'oferta de prueba de carrera en decide',
      modality: 'PRESENCIAL',
      seats: 2,
      requiredHours: 240,
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-07-31'),
      status: OfferStatus.PUBLISHED,
    },
  })
  const student = await prisma.user.create({
    data: { email: `decide-${suffix}-${offer.id}@test.local`, password: randomUUID(), fullName: 'Candidato', role: Role.STUDENT },
  })
  createdUserIds.push(student.id)
  const application = await prisma.application.create({
    data: { offerId: offer.id, studentId: student.id, motivation: 'm'.repeat(24), status: initial },
  })
  return application.id
}

async function decideTwice(id: number, first: ApplicationStatus, second: ApplicationStatus) {
  const service = new ApplicationService(prismaWithReadBarrier(new Barrier(2)) as never, { acceptedCount: async () => 0 } as never)
  const decisions = [first, second]
  const results = await Promise.allSettled(decisions.map((status) => service.decide(id, status, 0, Role.COORDINATOR)))
  const finalRow = await prisma.application.findUniqueOrThrow({ where: { id } })
  return { decisions, results, finalRow }
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `DR${suffix}`, name: `Empresa carrera ${suffix}`, sector: 'TI', contactEmail: `decide-${suffix}@test.local` },
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

describe('decide — dos decisiones simultáneas sobre la misma postulación', () => {
  it.each([
    ['aceptar y rechazar', ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.SUBMITTED],
    ['rechazar y aceptar', ApplicationStatus.REJECTED, ApplicationStatus.ACCEPTED, ApplicationStatus.SUBMITTED],
    ['aceptar y aceptar', ApplicationStatus.ACCEPTED, ApplicationStatus.ACCEPTED, ApplicationStatus.SUBMITTED],
    ['desde INTERVIEW, rechazar y aceptar', ApplicationStatus.REJECTED, ApplicationStatus.ACCEPTED, ApplicationStatus.INTERVIEW],
  ])('%s: exactamente una gana y la otra recibe "la postulación ya fue decidida"', async (_caso, first, second, initial) => {
    const id = await createSubmittedApplication(initial)

    const { decisions, results, finalRow } = await decideTwice(id, first, second)

    const winners = results.flatMap((r, i) => (r.status === 'fulfilled' ? [i] : []))
    expect(winners).toHaveLength(1)

    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(loser?.reason).toBeInstanceOf(BadRequestException)
    expect((loser?.reason as BadRequestException).message).toBe('la postulación ya fue decidida')

    // El estado final es el de la decisión ganadora, y quien ganó recibe esa misma fila.
    expect(finalRow.status).toBe(decisions[winners[0]])
    expect(finalRow.decidedAt).not.toBeNull()
    const winnerResult = results[winners[0]] as PromiseFulfilledResult<{ status: ApplicationStatus }>
    expect(winnerResult.value.status).toBe(finalRow.status)
  })
})
