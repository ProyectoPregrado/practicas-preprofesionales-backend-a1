import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateOfferDto } from '../../offer/dto/create-offer.dto'
import { TIME_ZONES, useTimeZone } from '../../test/time-zone'
import { CreateHourLogDto } from './create-hour-log.dto'

// E6-02: el servidor normaliza la fecha; no confía en la zona del dispositivo ni en la del servidor.
describe.each(TIME_ZONES)('CreateHourLogDto.date (E6-02), zona del servidor %s', (zone) => {
  useTimeZone(zone)

  const parse = (date: unknown) => {
    const dto = plainToInstance(CreateHourLogDto, {
      placementId: 1,
      date,
      startTime: '08:00',
      endTime: '12:00',
      hours: 4,
      activity: 'Desarrollo',
    })
    return { dto, errors: validateSync(dto).filter((error) => error.property === 'date') }
  }

  it('AAAA-MM-DD queda como el día indicado', () => {
    const { dto, errors } = parse('2026-03-02')
    expect(errors).toHaveLength(0)
    expect(dto.date.toISOString()).toBe('2026-03-02T00:00:00.000Z')
  })

  it('el mismo instante desde dispositivos en zonas distintas da el mismo día guardado', () => {
    const stored = ['2026-03-02T15:00:00Z', '2026-03-02T10:00:00-05:00', '2026-03-03T04:00:00+13:00'].map((value) =>
      parse(value).dto.date.toISOString(),
    )
    expect(stored).toEqual(Array(3).fill('2026-03-02T00:00:00.000Z'))
  })

  it('una fecha con offset ya no corre el día', () => {
    expect(parse('2026-03-02T22:00:00-05:00').dto.date.toISOString()).toBe('2026-03-02T00:00:00.000Z')
  })

  it.each(['', 'ayer', '2026-02-31', 20260302, null])('rechaza %j', (value) => {
    expect(parse(value).errors).not.toHaveLength(0)
  })
})

describe('CreateOfferDto: el período también son días calendario (E6-02)', () => {
  it('normaliza periodStart y periodEnd', () => {
    const dto = plainToInstance(CreateOfferDto, {
      companyId: 1,
      title: 'x',
      description: 'x',
      modality: 'REMOTA',
      seats: 1,
      requiredHours: 240,
      periodStart: '2026-03-01T20:00:00-05:00',
      periodEnd: '2026-07-31',
    })
    expect(validateSync(dto)).toHaveLength(0)
    expect(dto.periodStart.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(dto.periodEnd.toISOString()).toBe('2026-07-31T00:00:00.000Z')
  })
})
