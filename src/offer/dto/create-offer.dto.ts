import { Transform } from 'class-transformer'
import { IsDate, IsInt, IsString, Min } from 'class-validator'
import { normalizeCalendarDay } from '../../common/calendar-date'

export class CreateOfferDto {
  @IsInt() companyId!: number
  @IsString() title!: string
  @IsString() description!: string
  @IsString() modality!: string
  @IsInt() @Min(1) seats!: number
  @IsInt() @Min(1) requiredHours!: number
  // E6-02: el período de la oferta son días calendario; se normalizan en el servidor.
  @Transform(({ value }) => normalizeCalendarDay(value)) @IsDate() periodStart!: Date
  @Transform(({ value }) => normalizeCalendarDay(value)) @IsDate() periodEnd!: Date
}
