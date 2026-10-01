import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccreditationService } from './accreditation.service'

const prisma = {
  placement: { findMany: vi.fn() },
  hourLog: { aggregate: vi.fn() },
}

describe('AccreditationService — E3-06 (no filtrar datos sensibles)', () => {
  let service: AccreditationService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 10 } })
    service = new AccreditationService(prisma as never)
  })

  it('consulta al estudiante acotando explícitamente los campos (nunca `student: true`)', async () => {
    prisma.placement.findMany.mockResolvedValue([])

    await service.reportForPeriod('2026-1')

    const call = prisma.placement.findMany.mock.calls[0][0]
    expect(call.include.student).not.toBe(true)
    expect(call.include.student).toEqual({ select: { fullName: true } })
  })

  it('el reporte nunca incluye el password del estudiante, aunque la consulta lo trajera', async () => {
    // Simula el escenario que el bug original permitía: la fila que devuelve la
    // base trae el usuario completo. El test tiene que fallar si el servicio
    // vuelve a filtrar ese objeto entero al resultado.
    prisma.placement.findMany.mockResolvedValue([
      {
        id: 1,
        requiredHours: 300,
        status: 'ACTIVE',
        student: { fullName: 'Estudiante de Prueba', password: '$2b$10$hash-secreto', email: 'e@miyura.com' },
        documents: [],
        evaluations: [],
      },
    ])

    const result = await service.reportForPeriod('2026-1')

    expect(JSON.stringify(result)).not.toContain('hash-secreto')
    expect(JSON.stringify(result)).not.toMatch(/"password"/)
  })
})
