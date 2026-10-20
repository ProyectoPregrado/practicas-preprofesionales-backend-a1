import { describe, expect, it } from 'vitest'
import { TIME_ZONES, useTimeZone } from '../test/time-zone'
import {
  calendarDayInZone,
  formatDay,
  getInstitutionTimeZone,
  isoWeekLabel,
  normalizeCalendarDay,
  periodBounds,
} from './calendar-date'

describe.each(TIME_ZONES)('calendar-date (E6-02), zona %s', (zone) => {
  useTimeZone(zone)

  it('periodBounds da medianoche UTC, igual en cualquier zona', () => {
    const iso = (period: string) => Object.values(periodBounds(period)).map((d) => d.toISOString())

    expect(iso('2026-1')).toEqual(['2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'])
    expect(iso('2026-2')).toEqual(['2026-07-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
  })

  it.each([
    ['2026-03-02', '2026-W10'], // lunes
    ['2026-03-08', '2026-W10'], // domingo
    ['2026-03-09', '2026-W11'],
    ['2025-12-29', '2026-W01'], // lunes de la primera semana de 2026
    ['2026-01-01', '2026-W01'],
    ['2027-01-01', '2026-W53'], // viernes: aún es de la última semana de 2026
    ['2027-01-04', '2027-W01'],
  ])('isoWeekLabel(%s) es %s', (day, week) => {
    expect(isoWeekLabel(new Date(day))).toBe(week)
  })
})

// E6-02: la fecha que manda un cliente se normaliza en el servidor a un día calendario.
describe('getInstitutionTimeZone', () => {
  it('por defecto es America/Guayaquil', () => {
    expect(getInstitutionTimeZone({} as NodeJS.ProcessEnv)).toBe('America/Guayaquil')
  })

  it('se configura con INSTITUTION_TIME_ZONE', () => {
    expect(getInstitutionTimeZone({ INSTITUTION_TIME_ZONE: 'Europe/Madrid' } as NodeJS.ProcessEnv)).toBe('Europe/Madrid')
  })

  it('una zona inválida falla con un mensaje que la nombra', () => {
    expect(() => getInstitutionTimeZone({ INSTITUTION_TIME_ZONE: 'Marte/Olimpo' } as NodeJS.ProcessEnv)).toThrow(
      /INSTITUTION_TIME_ZONE.*Marte\/Olimpo/,
    )
  })
})

describe.each(TIME_ZONES)('normalizeCalendarDay (E6-02), zona del servidor %s', (zone) => {
  useTimeZone(zone)
  const day = (value: unknown, institution = 'America/Guayaquil') => {
    const result = normalizeCalendarDay(value, institution)
    return Number.isNaN(result.getTime()) ? 'inválida' : formatDay(result)
  }

  it('una fecha AAAA-MM-DD se respeta tal cual, sin importar la zona del dispositivo', () => {
    expect(normalizeCalendarDay('2026-03-02', 'America/Guayaquil').toISOString()).toBe('2026-03-02T00:00:00.000Z')
    expect(normalizeCalendarDay('2026-03-02', 'Pacific/Auckland').toISOString()).toBe('2026-03-02T00:00:00.000Z')
  })

  it('el mismo instante enviado desde dispositivos en zonas distintas da el mismo día', () => {
    const sameInstant = [
      '2026-03-02T15:00:00Z', // UTC
      '2026-03-02T10:00:00-05:00', // Ecuador
      '2026-03-03T04:00:00+13:00', // Nueva Zelanda
      '2026-03-02T16:00:00+01:00', // Madrid
    ]
    expect(sameInstant.map((value) => day(value))).toEqual(Array(4).fill('2026-03-02'))
  })

  it('un cliente con offset ya no corre el día (antes 22:00-05:00 se guardaba como el 3)', () => {
    expect(day('2026-03-02T22:00:00-05:00')).toBe('2026-03-02')
  })

  it('el borde de la zona de la institución: 04:59Z es el 2 y 05:00Z es el 3 (Ecuador)', () => {
    expect(day('2026-03-03T04:59:00Z')).toBe('2026-03-02')
    expect(day('2026-03-03T05:00:00Z')).toBe('2026-03-03')
  })

  it('usa la zona de la institución que se le indique', () => {
    expect(day('2026-03-02T23:30:00-05:00', 'Pacific/Auckland')).toBe('2026-03-03')
    expect(calendarDayInZone(new Date('2026-03-02T23:30:00-05:00'), 'America/Guayaquil').toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    )
  })

  it.each(['', 'hoy', '2026-02-31', '2026-13-01', 123, null, undefined, {}])('rechaza %j', (value) => {
    expect(day(value)).toBe('inválida')
  })
})
