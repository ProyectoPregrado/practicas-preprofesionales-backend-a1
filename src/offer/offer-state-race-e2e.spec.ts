import 'dotenv/config'
import { BadRequestException } from '@nestjs/common'
import { OfferStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfferService } from './offer.service'

// N-5: carrera en `publish` y `close` sobre la MISMA oferta, contra Postgres real.
//
// Las dos operaciones leen el estado, validan y escriben. Si llegan a la vez, las dos pueden pasar el
// chequeo y las dos escribir: la última pisa a la primera y la primera cree que fue quien publicó o
// cerró. La barrera fuerza el peor intercalado (las dos LEEN antes de que cualquiera ESCRIBA), sin sleeps.

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
let companyId = 0

// Igual que el cliente real, salvo que cada `findUnique` de oferta espera en la barrera DESPUÉS de leer.
function prismaWithReadBarrier(barrier: Barrier) {
  const offer = new Proxy(prisma.offer, {
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
      if (prop === 'offer') return offer
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function createOffer(status: OfferStatus) {
  return prisma.offer.create({
    data: {
      companyId,
      title: `Carrera estado ${suffix}`,
      description: 'oferta de prueba de carrera en publish/close',
      modality: 'PRESENCIAL',
      seats: 2,
      requiredHours: 240,
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2026-07-31'),
      status,
      publishedAt: status === OfferStatus.DRAFT ? null : new Date('2026-01-01'),
    },
  })
}

async function runTwice(action: 'publish' | 'close', id: number) {
  const service = new OfferService(prismaWithReadBarrier(new Barrier(2)) as never)
  const results = await Promise.allSettled([1, 2].map(() => service[action](id, 0, Role.COORDINATOR)))
  const finalRow = await prisma.offer.findUniqueOrThrow({ where: { id } })
  return { results, finalRow }
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `OS${suffix}`, name: `Empresa estado ${suffix}`, sector: 'TI', contactEmail: `offer-state-${suffix}@test.local` },
  })
  companyId = company.id
})

afterAll(async () => {
  await prisma.offer.deleteMany({ where: { companyId } })
  await prisma.company.delete({ where: { id: companyId } })
  await prisma.$disconnect()
})

describe('publish y close — dos llamadas simultáneas sobre la misma oferta', () => {
  it('publish: exactamente una gana y la otra recibe "solo se publican ofertas en DRAFT"', async () => {
    const offer = await createOffer(OfferStatus.DRAFT)

    const { results, finalRow } = await runTwice('publish', offer.id)

    const winners = results.flatMap((r, i) => (r.status === 'fulfilled' ? [i] : []))
    expect(winners).toHaveLength(1)
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(loser?.reason).toBeInstanceOf(BadRequestException)
    expect((loser?.reason as BadRequestException).message).toBe('solo se publican ofertas en DRAFT')

    // Quien ganó recibe la misma fila que quedó guardada: la perdedora no pisó `publishedAt`.
    const won = (results[winners[0]] as PromiseFulfilledResult<{ publishedAt: Date | null }>).value
    expect(finalRow.status).toBe(OfferStatus.PUBLISHED)
    expect(finalRow.publishedAt?.getTime()).toBe(won.publishedAt?.getTime())
  })

  it('close: exactamente una gana y la otra recibe "solo se cierran ofertas publicadas"', async () => {
    const offer = await createOffer(OfferStatus.PUBLISHED)

    const { results, finalRow } = await runTwice('close', offer.id)

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(loser?.reason).toBeInstanceOf(BadRequestException)
    expect((loser?.reason as BadRequestException).message).toBe('solo se cierran ofertas publicadas')
    expect(finalRow.status).toBe(OfferStatus.CLOSED)
  })
})
