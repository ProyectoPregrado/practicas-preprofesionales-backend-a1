import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { HourLogModule } from './hour-log.module'
import { HourLogService } from './hour-log.service'

describe('E6-03 — composición de HourLogModule', () => {
  it('resuelve las dependencias reales y conserva el avance público', async () => {
    const module = await Test.createTestingModule({ imports: [PrismaModule, HourLogModule] })
      .overrideProvider(PrismaService)
      .useValue({
        placement: { findUnique: vi.fn().mockResolvedValue({ requiredHours: 8 }) },
        hourLog: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { hours: 4 } }),
          count: vi.fn().mockResolvedValue(1),
        },
      })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile()

    try {
      await expect(module.get(HourLogService).progressReport(1)).resolves.toEqual({
        placementId: 1, requiredHours: 8, approvedHours: 4, pendingLogs: 1, percentage: 50,
      })
    } finally {
      await module.close()
    }
  })
})
