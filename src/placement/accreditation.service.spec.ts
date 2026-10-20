import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TIME_ZONES, useTimeZone } from '../test/time-zone'
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
    const privatePassword = randomUUID()
    // Simula el escenario que el bug original permitía: la fila que devuelve la
    // base trae el usuario completo. El test tiene que fallar si el servicio
    // vuelve a filtrar ese objeto entero al resultado.
    prisma.placement.findMany.mockResolvedValue([
      {
        id: 1,
        requiredHours: 300,
        status: 'ACTIVE',
        student: { fullName: 'Estudiante de Prueba', password: privatePassword, email: 'e@miyura.com' },
        documents: [],
        evaluations: [],
      },
    ])

    const result = await service.reportForPeriod('2026-1')

    expect(JSON.stringify(result)).not.toContain(privatePassword)
    expect(JSON.stringify(result)).not.toMatch(/"password"/)
  })
})

// E6-02: una fecha de negocio es un día calendario guardado como medianoche UTC. Los límites del período
// no pueden depender de la zona horaria del servidor.
describe.each(TIME_ZONES)('AccreditationService — límites del período (E6-02), zona %s', (zone) => {
  useTimeZone(zone)
  let service: AccreditationService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.placement.findMany.mockResolvedValue([])
    service = new AccreditationService(prisma as never)
  })

  const boundsOf = async (period: string) => {
    await service.reportForPeriod(period)
    const { startDate } = prisma.placement.findMany.mock.calls[0][0].where
    return [startDate.gte.toISOString(), startDate.lt.toISOString()]
  }

  it('el período AAAA-1 va del 1 de enero al 1 de julio, medianoche UTC', async () => {
    expect(await boundsOf('2026-1')).toEqual(['2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'])
  })

  it('el período AAAA-2 va del 1 de julio al 1 de enero siguiente, medianoche UTC', async () => {
    expect(await boundsOf('2026-2')).toEqual(['2026-07-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
  })
})
