import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

export class DraftHourLogDto {
  /** Lo que la persona contó de su día, escrito o dictado. */
  @IsString() @IsNotEmpty() @MaxLength(2000) text!: string
  /** La fecha de hoy en el dispositivo (`AAAA-MM-DD`), para resolver «hoy» y «ayer». */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) today!: string
}
