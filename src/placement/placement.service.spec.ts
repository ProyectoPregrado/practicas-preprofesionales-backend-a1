import { Prisma } from '@prisma/client'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacementService } from './placement.service'

const prisma = {
  placement: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  document: { create: vi.fn() },
  application: { findUnique: vi.fn() },
}

describe('PlacementService.activate', () => {
  let service: PlacementService

  beforeEach(() => {
    vi.resetAllMocks()
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
  it('translates the ACTIVE student uniqueness violation to HTTP 409', async () => {
    prisma.placement.findUnique.mockResolvedValue({
      id: 1, status: 'PENDING_DOCS',
      documents: [{ kind: 'AGREEMENT', status: 'VALIDATED' }, { kind: 'INSURANCE', status: 'VALIDATED' }],
    })
    prisma.placement.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: ['studentId'] },
    }))

    await expect(service.activate(1)).rejects.toThrow(ConflictException)
  })

})
