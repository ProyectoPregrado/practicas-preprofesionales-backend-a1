import { DocumentKind } from '@prisma/client'
import { IsEnum } from 'class-validator'

/** Campos de texto del formulario multipart; el archivo va aparte, en el campo `file`. */
export class UploadDocumentFileDto {
  @IsEnum(DocumentKind) kind!: DocumentKind
}
