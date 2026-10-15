import 'dotenv/config'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApplicationService } from './application.service'

// N-2 (regla 1 y 3 del Sprint 3): "solo una postulación por estudiante y oferta" se prueba en
// paralelo y contra Postgres real, porque la garantía la da la restricción única de la base.
describe('ApplicationService.apply (N-2, Postgres real)', () => {
  const prisma = new PrismaService()
  const service = new ApplicationService(prisma, new OfferService(prisma))
  const tag = `n2-${Date.now()}`
  const MOTIVATION = 'Motivación de prueba N-2 con más de veinte caracteres'
  let studentId: number
  let companyId: number
  let offers: Record<'PUBLISHED' | 'DRAFT' | 'CLOSED', number>

  // Datos propios: el CI aplica las migraciones pero no el seed.
  beforeAll(async () => {
    await prisma.$connect()
    studentId = (
      await prisma.user.create({
        data: { email: `est-${tag}@miyura.com`, password: 'x', fullName: 'Estudiante N-2', role: 'STUDENT' },
      })
    ).id
    companyId = (
      await prisma.company.create({
        data: { taxId: `TAX-${tag}`, name: `Empresa ${tag}`, sector: 'TI', contactEmail: `e-${tag}@miyura.com` },
      })
    ).id
    const offer = async (status: 'PUBLISHED' | 'DRAFT' | 'CLOSED') =>
      (
        await prisma.offer.create({
          data: {
            companyId,
            title: `Oferta ${status}`,
            description: 'x',
            modality: 'Presencial',
            seats: 5,
            requiredHours: 240,
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 86_400_000 * 30),
            status,
          },
        })
      ).id
    offers = { PUBLISHED: await offer('PUBLISHED'), DRAFT: await offer('DRAFT'), CLOSED: await offer('CLOSED') }
  })

  afterAll(async () => {
    const offerIds = Object.values(offers ?? {})
    await prisma.application.deleteMany({ where: { offerId: { in: offerIds } } })
    await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
    await prisma.company.deleteMany({ where: { id: companyId } })
    await prisma.user.deleteMany({ where: { id: studentId } })
    await prisma.$disconnect()
  })

  it('responde 404 a una oferta inexistente (antes era un 500)', async () => {
    await expect(service.apply(2_000_000_000, studentId, MOTIVATION)).rejects.toThrow(NotFoundException)
  })

  it.each(['DRAFT', 'CLOSED'] as const)('responde 404 a una oferta %s y no crea la postulación', async (status) => {
    await expect(service.apply(offers[status], studentId, MOTIVATION)).rejects.toThrow(NotFoundException)

    expect(await prisma.application.count({ where: { offerId: offers[status] } })).toBe(0)
  })

  it('con dos envíos simultáneos del mismo estudiante, uno gana y el otro recibe 409', async () => {
    const results = await Promise.allSettled([
      service.apply(offers.PUBLISHED, studentId, MOTIVATION),
      service.apply(offers.PUBLISHED, studentId, MOTIVATION),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ConflictException)
    expect(await prisma.application.count({ where: { offerId: offers.PUBLISHED, studentId } })).toBe(1)
  })

  it('un envío posterior del mismo estudiante también recibe 409', async () => {
    await expect(service.apply(offers.PUBLISHED, studentId, MOTIVATION)).rejects.toThrow(ConflictException)
  })
})
