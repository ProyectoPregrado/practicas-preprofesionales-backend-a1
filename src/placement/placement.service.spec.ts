import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_COMPANY_SELECT } from '../company/company.select'
import { PlacementService } from './placement.service'

const prisma = {
  placement: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  document: { create: vi.fn() },
  application: { findUnique: vi.fn() },
}

describe('PlacementService.activate', () => {
  let service: PlacementService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PlacementService(prisma as never)
  })

  it('activates when AGREEMENT and INSURANCE are validated', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 1,
      status: 'PENDING_DOCS',
      documents: [
        { kind: 'AGREEMENT', status: 'VALIDATED' },
        { kind: 'INSURANCE', status: 'VALIDATED' },
      ],
    })
    prisma.placement.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

    const result = await service.activate(1)

    expect(result.status).toBe('ACTIVE')
  })

  it('refuses to activate when the insurance is missing', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 1,
      status: 'PENDING_DOCS',
      documents: [{ kind: 'AGREEMENT', status: 'VALIDATED' }],
    })

    await expect(service.activate(1)).rejects.toThrow(BadRequestException)
  })
})

// H-6 (T-4): la plaza propia trae la empresa sin NIT ni correo de contacto.
describe('PlacementService.findForStudent (H-6)', () => {
  it('incluye solo los campos públicos de la empresa', async () => {
    vi.clearAllMocks()
    prisma.placement.findFirst.mockResolvedValue(null)
    const service = new PlacementService(prisma as never)

    await service.findForStudent(10)

    expect(prisma.placement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ company: { select: PUBLIC_COMPANY_SELECT } }),
      }),
    )
  })
})
