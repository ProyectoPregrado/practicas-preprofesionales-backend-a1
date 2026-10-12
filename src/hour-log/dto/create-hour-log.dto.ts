import { Type } from 'class-transformer'
import { IsDate, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { MIN_HOURS_PER_LOG, getMaxHoursPerDay, hoursRangeMessage } from '../hour-rules'

export class CreateHourLogDto {
  @IsInt() placementId!: number

  @Type(() => Date) @IsDate() date!: Date

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime!: string

  // E6-01: el rango sale de hour-rules.ts, igual que en el servicio, el sync y la exportación.
  @Min(MIN_HOURS_PER_LOG, { message: hoursRangeMessage() })
  @Max(getMaxHoursPerDay(), { message: hoursRangeMessage() })
  hours!: number

  @IsString() @MaxLength(500) activity!: string
}
