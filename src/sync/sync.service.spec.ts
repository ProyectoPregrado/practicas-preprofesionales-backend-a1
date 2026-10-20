import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncService } from './sync.service'
import type { SyncOperationInput } from './dto/push.dto'

// E6-02: las fechas de un registro tienen que caer dentro de la práctica; estas plazas simuladas cubren abril de 2026.
const PRACTICE = { startDate: new Date('2026-03-01'), endDate: new Date('2026-07-31') }

const prisma = {
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  $executeRaw: vi.fn(),
  placement: { findMany: vi.fn(), findUnique: vi.fn() },
  hourLog: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    aggregate: vi.fn().mockResolvedValue({ _sum: { hours: null } }),
  },
  document: { findMany: vi.fn() },
  evaluation: { findMany: vi.fn() },
  syncOperation: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
}

describe('SyncService — pull', () => {
  let service: SyncService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.placement.findMany.mockResolvedValue([])
    prisma.hourLog.findMany.mockResolvedValue([])
    prisma.document.findMany.mockResolvedValue([])
    prisma.evaluation.findMany.mockResolvedValue([])
    // Por defecto, ningún clientOpId fue procesado (D-01)
    prisma.syncOperation.findUnique.mockResolvedValue(null)
    service = new SyncService(prisma as never)
  })

  // -------------------------------------------------------------------------
  // E1-05 — cursor determinista (updatedAt, id)
  // -------------------------------------------------------------------------

  it('devuelve todos los registros incluso cuando comparten el mismo updatedAt', async () => {
    const sharedTime = new Date('2026-04-01T12:00:00.000Z')
    prisma.hourLog.findMany.mockResolvedValue([
      { id: 1, updatedAt: sharedTime, placementId: 1 },
      { id: 2, updatedAt: sharedTime, placementId: 1 }, // mismo milisegundo
    ])

    const result = await service.pull(5, undefined, 200)

    expect(result.changes.hourLogs).toHaveLength(2)
    const ids = result.changes.hourLogs.map((r) => r.id)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
  })

  it('el checkpoint contiene el mayor id del último updatedAt del orden determinista', async () => {
    const sharedTime = new Date('2026-04-01T12:00:00.000Z')
    prisma.hourLog.findMany.mockResolvedValue([
      { id: 1, updatedAt: sharedTime, placementId: 1 },
      { id: 2, updatedAt: sharedTime, placementId: 1 },
    ])

    const result = await service.pull(5, undefined, 200)

    // El cursor encodeado debe decodificar a { updatedAt, id }
    const { decodeCheckpoint } = await import('./checkpoint')
    const cp = decodeCheckpoint(result.checkpoint!)!
    expect(cp.id).toBe(2) // id mayor (2) es el último del orden ASC por (updatedAt, id)
  })

  it('la segunda página retoma desde el cursor sin omitir registros', async () => {
    const sharedTime = new Date('2026-04-01T12:00:00.000Z')

    // Page 1: devuelve los dos registros con timestamp compartido
    prisma.hourLog.findMany
      .mockResolvedValueOnce([
        { id: 1, updatedAt: sharedTime, placementId: 1 },
        { id: 2, updatedAt: sharedTime, placementId: 1 },
      ])
      // Page 2: con el cursor correcto (2026-04-01T12:00:00.000Z, id=2),
      // no debe devolver nada más porque no hay más registros.
      .mockResolvedValueOnce([])

    // Primera página
    const page1 = await service.pull(5, undefined, 2)
    expect(page1.changes.hourLogs).toHaveLength(2)
    expect(page1.hasMore).toBe(true)

    // Segunda página con el checkpoint de la primera
    const page2 = await service.pull(5, page1.checkpoint!, 2)
    expect(page2.changes.hourLogs).toHaveLength(0)
    expect(page2.hasMore).toBe(false)
  })

  it('no se saltea ningún registro cuando updatedAt es exacto y id es mayor', async () => {
    const t1 = new Date('2026-04-01T10:00:00.000Z')
    const t2 = new Date('2026-04-01T10:00:00.000Z') // mismo ms

    prisma.hourLog.findMany
      .mockResolvedValueOnce([
        { id: 1, updatedAt: t1, placementId: 1 },
        { id: 2, updatedAt: t2, placementId: 1 },
      ])
      .mockResolvedValueOnce([])

    const page1 = await service.pull(5, undefined, 2)
    const page2 = await service.pull(5, page1.checkpoint!, 2)

    // Si el fix de cursor es correcto, page2 viene vacía (no se perdió ninguno)
    expect(page1.changes.hourLogs).toHaveLength(2)
    expect(page2.changes.hourLogs).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // D-01 — idempotencia con clientOpId
  // -------------------------------------------------------------------------

  it('rechaza operaciones de entidades no soportadas', async () => {
    const result = await service.push(5, [
      {
        clientOpId: '11111111-1111-4111-8111-111111111111',
        entity: 'placement',
        op: 'create',
        baseVersion: null,
        payload: {},
      },
    ])
    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toBe('entidad no sincronizable desde el cliente')
  })

  it('crea un registro hourLog cuando la operación es válida', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })

    const result = await service.push(5, [
      {
        clientOpId: '11111111-1111-4111-8111-111111111111',
        entity: 'hourLog',
        op: 'create',
        baseVersion: null,
        payload: {
          placementId: 1,
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Soporte',
        },
      },
    ])

    expect(result.results[0].status).toBe('applied')
    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.syncOperation.create).toHaveBeenCalledTimes(1)
  })

  it('D-01: un reintento con el mismo clientOpId NO aplica la operación dos veces', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })

    const op: SyncOperationInput = {
      clientOpId: '22222222-2222-4222-8222-222222222222',
      entity: 'hourLog',
      op: 'create',
      baseVersion: null,
      payload: {
        placementId: 1,
        date: '2026-04-02',
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Soporte',
      },
    }

    // Primera llamada: la reserva del clientOpId tiene éxito → aplica la operación
    await service.push(5, [op])
    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)

    // Segunda llamada (reintento secuencial) con el mismo clientOpId: la reserva
    // choca con la restricción única (ya existe la fila) y el resultado real
    // queda disponible de inmediato.
    prisma.syncOperation.create.mockRejectedValueOnce({ code: 'P2002' })
    prisma.syncOperation.findUnique.mockResolvedValue({
      clientOpId: '22222222-2222-4222-8222-222222222222',
      userId: 5,
      response: { clientOpId: '22222222-2222-4222-8222-222222222222', status: 'applied', server: { id: 77 }, reason: null },
    })

    await service.push(5, [op])
    // hourLog.create NO debe llamarse otra vez
    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)
  })

  it('D-01: el resultado del reintento es el mismo que el original', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })

    const op: SyncOperationInput = {
      clientOpId: '33333333-3333-4333-8333-333333333333',
      entity: 'hourLog',
      op: 'create',
      baseVersion: null,
      payload: {
        placementId: 1,
        date: '2026-04-02',
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Soporte',
      },
    }

    const first = await service.push(5, [op])
    expect(first.results[0].status).toBe('applied')

    // Simular que ya se había procesado antes: la reserva choca con la fila existente
    prisma.syncOperation.create.mockRejectedValueOnce({ code: 'P2002' })
    prisma.syncOperation.findUnique.mockResolvedValue({
      clientOpId: '33333333-3333-4333-8333-333333333333',
      userId: 5,
      response: first.results[0],
    })

    const retry = await service.push(5, [op])
    expect(retry.results[0].status).toBe('applied')
    expect(retry.results[0]).toMatchObject(first.results[0])
  })

  // -------------------------------------------------------------------------
  // E1-03b — deduplicación bajo concurrencia real (no solo reintento secuencial)
  // -------------------------------------------------------------------------

  it('E1-03b: dos envíos concurrentes con el mismo clientOpId no crean dos hourLog', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })

    const op: SyncOperationInput = {
      clientOpId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      entity: 'hourLog',
      op: 'create',
      baseVersion: null,
      payload: {
        placementId: 1,
        date: '2026-04-02',
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Soporte',
      },
    }

    // Simula la restricción única de Postgres sobre clientOpId: solo el primer
    // insert para este id puede ganar; el segundo, aunque "llegue al mismo
    // tiempo", encuentra la fila ya reservada y falla con P2002 — igual que
    // haría la base de datos real, sin depender de timers para decidir el orden.
    const reserved = new Set<string>()
    prisma.syncOperation.create.mockImplementation(async ({ data }: { data: { clientOpId: string } }) => {
      if (reserved.has(data.clientOpId)) {
        throw { code: 'P2002' }
      }
      reserved.add(data.clientOpId)
    })

    let stored: unknown = null
    prisma.syncOperation.update.mockImplementation(async ({ data }: { data: { response: unknown } }) => {
      stored = data.response
    })
    prisma.syncOperation.findUnique.mockImplementation(async () => ({
      response: stored ?? { status: 'pending' },
    }))

    const [r1, r2] = await Promise.all([service.push(5, [op]), service.push(5, [op])])

    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)
    expect(r1.results[0].status).toBe('applied')
    expect(r2.results[0]).toMatchObject(r1.results[0])
  })

  // -------------------------------------------------------------------------
  // Casos adicionales
  // -------------------------------------------------------------------------

  it('retorna hasMore=true cuando los registros pegan el límite', async () => {
    const sharedTime = new Date('2026-04-01T12:00:00.000Z')
    // Dos registros con mismo timestamp que caben justos en page 1
    prisma.hourLog.findMany
      .mockResolvedValueOnce([
        { id: 1, updatedAt: sharedTime, placementId: 1 },
        { id: 2, updatedAt: sharedTime, placementId: 1 },
      ])
      .mockResolvedValueOnce([])

    const result = await service.pull(5, undefined, 2)
    expect(result.hasMore).toBe(true) // rows.length === limit → puede haber más
  })

  it('retorna hasMore=false cuando hay menos registros que el límite', async () => {
    const result = await service.pull(5, undefined, 200)
    expect(result.hasMore).toBe(false)
  })

  it('retorna checkpoint null cuando no hay cambios', async () => {
    const result = await service.pull(5, undefined, 200)
    expect(result.checkpoint).toBeNull()
    expect(result.changes.hourLogs).toHaveLength(0)
  })

  it('actualiza un hourLog existente', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 1,
      placement: { studentId: 5, ...PRACTICE },
    })
    prisma.hourLog.update.mockResolvedValue({ id: 1, version: 2 })

    const result = await service.push(5, [
      {
        clientOpId: '44444444-4444-4444-8444-444444444444',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: { id: 1, date: '2026-04-02', startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Nuevo' },
      },
    ])

    expect(result.results[0].status).toBe('applied')
    expect(prisma.hourLog.update).toHaveBeenCalledTimes(1)
  })

  it('soft-deletea un hourLog con op=delete', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 1,
      placement: { studentId: 5, ...PRACTICE },
    })
    prisma.hourLog.update.mockResolvedValue({ id: 1, version: 2, deletedAt: new Date() })

    const result = await service.push(5, [
      {
        clientOpId: '55555555-5555-4555-8555-555555555555',
        entity: 'hourLog',
        op: 'delete',
        baseVersion: 1,
        payload: { id: 1 },
      },
    ])

    expect(result.results[0].status).toBe('applied')
    expect(prisma.hourLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
  })

  it('E1-04: rechaza el delete offline si la hora ya fue aprobada (APPROVED)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 20,
      status: 'APPROVED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        entity: 'hourLog',
        op: 'delete',
        baseVersion: 1,
        payload: { id: 20 },
      },
    ])

    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toContain('APPROVED')
    expect(result.results[0].server).toBeDefined()
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('E1-04: rechaza el delete offline si la hora ya fue rechazada (REJECTED)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 21,
      status: 'REJECTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        entity: 'hourLog',
        op: 'delete',
        baseVersion: 1,
        payload: { id: 21 },
      },
    ])

    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toContain('REJECTED')
    expect(result.results[0].server).toBeDefined()
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })


  // -------------------------------------------------------------------------
  // E1-04 — Autoridad del servidor: rechazar edición de horas resueltas
  // -------------------------------------------------------------------------

  it('E1-04: rechaza la edición offline si la hora ya fue aprobada por el tutor (APPROVED)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 10,
      status: 'APPROVED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '66666666-6666-4666-8666-666666666666',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: { id: 10, activity: 'Intento de cambio offline', hours: 6 },
      },
    ])

    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toContain('APPROVED')
    expect(result.results[0].server).toBeDefined()
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('E1-04: rechaza la edición offline si la hora ya fue rechazada por el tutor (REJECTED)', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 11,
      status: 'REJECTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })

    const result = await service.push(5, [
      {
        clientOpId: '77777777-7777-4777-8777-777777777777',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: { id: 11, activity: 'Otro cambio offline', hours: 5 },
      },
    ])

    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toContain('REJECTED')
    expect(result.results[0].server).toBeDefined()
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('E1-04: rechaza la actualización si la versión del cliente es más antigua que la del servidor', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 12,
      status: 'SUBMITTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T14:00:00.000Z'), // Servidor más reciente
    })

    const result = await service.push(5, [
      {
        clientOpId: '88888888-8888-4888-8888-888888888888',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 12,
          updatedAt: '2026-04-02T12:00:00.000Z', // Cliente más antiguo
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Cambio retrasado',
        },
      },
    ])

    expect(result.results[0].status).toBe('rejected')
    expect(result.results[0].reason).toContain('más reciente')
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('E1-04: permite la actualización en SUBMITTED/DRAFT si el cliente tiene marca de tiempo igual o más reciente', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 13,
      status: 'SUBMITTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })
    prisma.hourLog.update.mockResolvedValue({ id: 13, version: 2, status: 'SUBMITTED' })

    const result = await service.push(5, [
      {
        clientOpId: '99999999-9999-4999-8999-999999999999',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: {
          id: 13,
          updatedAt: '2026-04-02T11:00:00.000Z', // Más reciente que el servidor
          date: '2026-04-02',
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Cambio offline válido',
        },
      },
    ])

    expect(result.results[0].status).toBe('applied')
    expect(prisma.hourLog.update).toHaveBeenCalledTimes(1)
  })
})

// E6-01: el sync aplicaba horas sin validarlas; ahora usa la misma regla que POST /hour-logs.
describe('SyncService — tope de horas por día (E6-01)', () => {
  let service: SyncService

  const createOp = (hours: number, clientOpId: string): SyncOperationInput => ({
    clientOpId,
    entity: 'hourLog',
    op: 'create',
    baseVersion: null,
    payload: { placementId: 1, date: '2026-04-02', startTime: '08:00', endTime: '18:00', hours, activity: 'Soporte' },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.create.mockResolvedValue({ id: 77, version: 1 })
    service = new SyncService(prisma as never)
  })

  it('rechaza un registro de más de 8 horas con el motivo, sin escribir', async () => {
    const { results } = await service.push(5, [createOp(9, 'e6-01-aaaa-0001')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toMatch(/entre 0\.5 y 8/)
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('rechaza si, sumado a lo ya registrado ese día, pasa de 8 horas', async () => {
    prisma.hourLog.aggregate.mockResolvedValueOnce({ _sum: { hours: 7 } })

    const { results } = await service.push(5, [createOp(2, 'e6-01-aaaa-0002')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toMatch(/no puede superar 8 horas \(ya tienes 7 registradas el 2026-04-02\)/)
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('acepta completar el día justo en 8 horas', async () => {
    prisma.hourLog.aggregate.mockResolvedValueOnce({ _sum: { hours: 6 } })

    const { results } = await service.push(5, [createOp(2, 'e6-01-aaaa-0003')])

    expect(results[0].status).toBe('applied')
    expect(prisma.hourLog.create).toHaveBeenCalledTimes(1)
  })

  it('al editar, el registro no se cuenta a sí mismo en la suma del día', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 31,
      status: 'SUBMITTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })
    prisma.hourLog.update.mockResolvedValue({ id: 31, version: 2 })

    const { results } = await service.push(5, [
      {
        clientOpId: 'e6-01-aaaa-0004',
        entity: 'hourLog',
        op: 'update',
        baseVersion: 1,
        payload: { id: 31, date: '2026-04-02', startTime: '08:00', endTime: '16:00', hours: 8, activity: 'Ajuste' },
      },
    ])

    expect(results[0].status).toBe('applied')
    expect(prisma.hourLog.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 31 } }) }),
    )
  })
})

// E6-02: el sync aplica la misma regla de fecha que POST /hour-logs, y normaliza lo que manda el cliente.
describe('SyncService: fecha del registro (E6-02)', () => {
  let service: SyncService

  const createOp = (date: string, clientOpId: string): SyncOperationInput => ({
    clientOpId,
    entity: 'hourLog',
    op: 'create',
    baseVersion: null,
    payload: { placementId: 1, date, startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Soporte' },
  })

  const updateOp = (date: string, clientOpId: string): SyncOperationInput => ({
    clientOpId,
    entity: 'hourLog',
    op: 'update',
    baseVersion: 1,
    payload: { id: 31, date, startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Soporte' },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'))
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, ...PRACTICE })
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 0 } })
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 77, ...data }))
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 31,
      status: 'SUBMITTED',
      placement: { studentId: 5, ...PRACTICE },
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    })
    prisma.hourLog.update.mockResolvedValue({ id: 31, version: 2 })
    service = new SyncService(prisma as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rechaza crear fuera de la práctica, con el rango válido y sin escribir', async () => {
    const { results } = await service.push(5, [createOp('2026-08-05', 'e6-02-aaaa-0001')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toBe('la fecha debe estar entre 2026-03-01 y 2026-07-31, los días de la práctica')
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('rechaza crear con fecha futura aunque esté dentro de la práctica', async () => {
    vi.setSystemTime(new Date('2026-04-10T15:00:00Z'))

    const { results } = await service.push(5, [createOp('2026-04-11', 'e6-02-aaaa-0002')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toBe('no se pueden registrar horas con fecha futura (hoy es 2026-04-10)')
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('rechaza una fecha que no existe', async () => {
    const { results } = await service.push(5, [createOp('2026-02-31', 'e6-02-aaaa-0003')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toBe('la fecha no es válida')
  })

  it('un instante con offset se guarda como el día de la zona de la institución', async () => {
    const { results } = await service.push(5, [createOp('2026-04-02T22:00:00-05:00', 'e6-02-aaaa-0004')])

    expect(results[0].status).toBe('applied')
    expect(prisma.hourLog.create.mock.calls[0][0].data.date.toISOString()).toBe('2026-04-02T00:00:00.000Z')
  })

  it('rechaza editar a una fecha fuera de la práctica, sin escribir', async () => {
    const { results } = await service.push(5, [updateOp('2026-09-01', 'e6-02-aaaa-0005')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toMatch(/la fecha debe estar entre 2026-03-01 y 2026-07-31/)
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('rechaza editar a una fecha futura', async () => {
    vi.setSystemTime(new Date('2026-04-10T15:00:00Z'))

    const { results } = await service.push(5, [updateOp('2026-04-30', 'e6-02-aaaa-0006')])

    expect(results[0].status).toBe('rejected')
    expect(results[0].reason).toMatch(/fecha futura/)
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })
})
