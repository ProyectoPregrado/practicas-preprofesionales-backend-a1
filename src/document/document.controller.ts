import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Role } from '@prisma/client'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { MAX_DOCUMENT_BYTES, inlineDisposition } from './document-file'
import { DocumentService, type UploadedDocumentFile } from './document.service'
import { UploadDocumentFileDto } from './dto/upload-document-file.dto'

type AuthedRequest = { user: { sub: number; role: Role } }

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  // multer corta la lectura un byte después del tope y responde 413: un archivo enorme no llega a memoria entero.
  @Post('placements/:id/documents/upload')
  @Roles(Role.STUDENT, Role.COORDINATOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  upload(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadDocumentFileDto,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.service.upload(id, dto.kind, file, req.user)
  }

  // `nosniff`: el navegador usa el tipo que decidió el servidor al subirlo, no el que adivine del contenido.
  @Get('documents/:id/file')
  @Roles(Role.STUDENT, Role.TUTOR, Role.COORDINATOR)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async file(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    const { stream, mimeType, filename, size } = await this.service.openFile(id, req.user)
    return new StreamableFile(stream, { type: mimeType, disposition: inlineDisposition(filename), length: size })
  }
}
