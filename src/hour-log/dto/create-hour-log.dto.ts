import { Transform } from 'class-transformer'
import { IsDate, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { normalizeCalendarDay } from '../../common/calendar-date'
import { MIN_HOURS_PER_LOG, getMaxHoursPerDay, hoursRangeMessage } from '../hour-rules'

export class CreateHourLogDto {
  @IsInt() placementId!: number

  // E6-02: se normaliza al día calendario en el servidor (zona de la institución), no se confía en el cliente.
  @Transform(({ value }) => normalizeCalendarDay(value)) @IsDate({ message: 'la fecha no es válida (formato AAAA-MM-DD)' }) date!: Date

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime!: string

  // E6-01: el rango sale de hour-rules.ts, igual que en el servicio, el sync y la exportación.
  @Min(MIN_HOURS_PER_LOG, { message: hoursRangeMessage() })
  @Max(getMaxHoursPerDay(), { message: hoursRangeMessage() })
  hours!: number

  @IsString() @MaxLength(500) activity!: string
}
