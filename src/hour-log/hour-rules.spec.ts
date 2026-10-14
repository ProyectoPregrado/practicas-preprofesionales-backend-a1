import { describe, expect, it, vi } from 'vitest'
import {
  MIN_HOURS_PER_LOG,
  dailyHoursError,
  getMaxHoursPerDay,
  hoursRangeError,
  timeOrderError,
} from './hour-rules'

describe('getMaxHoursPerDay — E6-01', () => {
  it('es 8 por defecto (decisión de la coordinación)', () => {
    expect(getMaxHoursPerDay({} as NodeJS.ProcessEnv)).toBe(8)
  })

  it('se puede configurar con MAX_HOURS_PER_DAY', () => {
    expect(getMaxHoursPerDay({ MAX_HOURS_PER_DAY: '6' } as NodeJS.ProcessEnv)).toBe(6)
  })

  it('ignora un valor inválido y usa el default', () => {
    expect(getMaxHoursPerDay({ MAX_HOURS_PER_DAY: 'x' } as NodeJS.ProcessEnv)).toBe(8)
    expect(getMaxHoursPerDay({ MAX_HOURS_PER_DAY: '-1' } as NodeJS.ProcessEnv)).toBe(8)
  })
})

describe('hoursRangeError — bordes del rango por registro', () => {
  it.each([MIN_HOURS_PER_LOG, 1, 7.5, 8])('%s horas es válido', (hours) => {
    expect(hoursRangeError(hours)).toBeNull()
  })

  it.each([0, 0.49, 8.01, 10, 12, -1])('%s horas se rechaza', (hours) => {
    expect(hoursRangeError(hours)).toMatch(/entre 0\.5 y 8/)
  })
})

describe('timeOrderError', () => {
  it('acepta inicio anterior al fin', () => {
    expect(timeOrderError('08:00', '12:00')).toBeNull()
  })

  it.each([
    ['12:00', '08:00'],
    ['08:00', '08:00'],
  ])('rechaza %s -> %s', (start, end) => {
    expect(timeOrderError(start, end)).toMatch(/inicio debe ser anterior/)
  })
})

describe('dailyHoursError — suma diaria del estudiante', () => {
  const dbWith = (sum: number | null) => ({ hourLog: { aggregate: vi.fn().mockResolvedValue({ _sum: { hours: sum } }) } })
  const date = new Date('2026-04-02T00:00:00.000Z')

  it('permite llegar justo al tope: 5 ya registradas + 3 = 8', async () => {
    expect(await dailyHoursError(dbWith(5) as never, 1, date, 3)).toBeNull()
  })

  it('rechaza pasarse por un poco: 5 ya registradas + 3.5 = 8.5', async () => {
    expect(await dailyHoursError(dbWith(5) as never, 1, date, 3.5)).toMatch(/no puede superar 8 horas/)
  })

  it('el mensaje dice cuánto ya hay registrado y en qué fecha', async () => {
    expect(await dailyHoursError(dbWith(6) as never, 1, date, 4)).toMatch(/ya tienes 6 registradas el 2026-04-02/)
  })

  it('sin registros previos el día entero está disponible', async () => {
    expect(await dailyHoursError(dbWith(null) as never, 1, date, 8)).toBeNull()
  })

  it('suma por estudiante y por día UTC, sin contar rechazadas ni borradas, y excluye el propio registro al editar', async () => {
    const db = dbWith(0)

    await dailyHoursError(db as never, 7, new Date('2026-04-02T15:30:00.000Z'), 2, 99)

    expect(db.hourLog.aggregate).toHaveBeenCalledWith({
      _sum: { hours: true },
      where: {
        placement: { studentId: 7 },
        date: { gte: new Date('2026-04-02T00:00:00.000Z'), lt: new Date('2026-04-03T00:00:00.000Z') },
        deletedAt: null,
        status: { not: 'REJECTED' },
        id: { not: 99 },
      },
    })
  })
})
