import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_COMPANY_SELECT } from './company.select'
import { CompanyService } from './company.service'

const prisma = { company: { findMany: vi.fn(), create: vi.fn() } }

// H-6 (T-4): taxId y contactEmail solo para la coordinación.
describe('CompanyService.findAll', () => {
  let service: CompanyService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new CompanyService(prisma as never)
    prisma.company.findMany.mockResolvedValue([])
  })

  it('devuelve la empresa completa a la coordinación', async () => {
    await service.findAll(Role.COORDINATOR)

    expect(prisma.company.findMany).toHaveBeenCalledWith()
  })

  it.each([Role.STUDENT, Role.TUTOR, Role.COMPANY])('acota los campos para el rol %s', async (role) => {
    await service.findAll(role)

    expect(prisma.company.findMany).toHaveBeenCalledWith({ select: PUBLIC_COMPANY_SELECT })
  })

  it('el select público no incluye taxId ni contactEmail', () => {
    expect(PUBLIC_COMPANY_SELECT).not.toHaveProperty('taxId')
    expect(PUBLIC_COMPANY_SELECT).not.toHaveProperty('contactEmail')
  })
})
