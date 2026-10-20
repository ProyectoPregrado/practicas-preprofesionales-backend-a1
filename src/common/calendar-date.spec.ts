import { describe, expect, it } from 'vitest'
import { TIME_ZONES, useTimeZone } from '../test/time-zone'
import { isoWeekLabel, periodBounds } from './calendar-date'

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
