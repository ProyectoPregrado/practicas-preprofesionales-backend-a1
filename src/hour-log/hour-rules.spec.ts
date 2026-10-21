import { describe, expect, it, vi } from 'vitest'
import {
  MIN_HOURS_PER_LOG,
  dailyHoursError,
  dateRangeError,
  futureDateError,
  getMaxHoursPerDay,
  hourDateError,
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

// E6-02: una fecha de registro cae dentro de la práctica y no es futura.
describe('reglas de fecha de un registro — E6-02', () => {
  const practice = { startDate: new Date('2026-03-01'), endDate: new Date('2026-07-31') }
  const day = (value: string) => new Date(value)

  describe('dateRangeError', () => {
    it('acepta el primer y el último día de la práctica y uno intermedio', () => {
      expect(dateRangeError(day('2026-03-01'), practice)).toBeNull()
      expect(dateRangeError(day('2026-05-10'), practice)).toBeNull()
      expect(dateRangeError(day('2026-07-31'), practice)).toBeNull()
    })

    it('rechaza el día anterior al inicio y el posterior al fin, diciendo cuál es el rango válido', () => {
      const message = 'la fecha debe estar entre 2026-03-01 y 2026-07-31, los días de la práctica'
      expect(dateRangeError(day('2026-02-28'), practice)).toBe(message)
      expect(dateRangeError(day('2026-08-01'), practice)).toBe(message)
    })

    it('rechaza una fecha inválida', () => {
      expect(dateRangeError(new Date(NaN), practice)).not.toBeNull()
    })
  })

  describe('futureDateError', () => {
    const now = new Date('2026-04-10T15:00:00Z') // 10:00 en Ecuador

    it('acepta hoy y los días pasados', () => {
      expect(futureDateError(day('2026-04-10'), now)).toBeNull()
      expect(futureDateError(day('2026-04-09'), now)).toBeNull()
    })

    it('rechaza mañana, diciendo cuál es hoy', () => {
      expect(futureDateError(day('2026-04-11'), now)).toBe('no se pueden registrar horas con fecha futura (hoy es 2026-04-10)')
    })

    it('«hoy» es el de la zona de la institución: a las 03:00Z todavía es el día anterior en Ecuador', () => {
      const earlyUtc = new Date('2026-04-11T03:00:00Z')
      expect(futureDateError(day('2026-04-10'), earlyUtc)).toBeNull()
      expect(futureDateError(day('2026-04-11'), earlyUtc)).not.toBeNull()
    })
  })

  it('hourDateError da primero el error de rango y después el de fecha futura', () => {
    const now = new Date('2026-04-10T15:00:00Z')
    expect(hourDateError(day('2026-12-01'), practice, now)).toMatch(/debe estar entre/)
    expect(hourDateError(day('2026-04-11'), practice, now)).toMatch(/fecha futura/)
    expect(hourDateError(day('2026-04-10'), practice, now)).toBeNull()
  })
})
