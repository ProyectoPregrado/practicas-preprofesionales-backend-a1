import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Role } from '@prisma/client'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AiService } from './ai.service'
import { DraftHourLogDto } from './dto/draft-hour-log.dto'
import { MAX_AUDIO_BYTES } from './transcribe'

type AuthedRequest = { user: { sub: number; role: Role } }

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly service: AiService) {}

  /** Si la IA está configurada, para que la interfaz lo muestre. */
  @Get('status')
  @Roles(Role.STUDENT, Role.TUTOR, Role.COMPANY, Role.COORDINATOR)
  status() {
    return this.service.status()
  }

  @Post('hour-log-draft')
  @Roles(Role.STUDENT)
  draft(@Body() dto: DraftHourLogDto) {
    return this.service.draftHourLog(dto.text, dto.today)
  }

  // IA-3: el audio del dictado (multipart, campo `audio`). multer corta la lectura pasado el tope y responde 413.
  @Post('transcribe')
  @Roles(Role.STUDENT)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  transcribe(@UploadedFile() audio: { buffer: Buffer; size: number; mimetype: string } | undefined) {
    return this.service.transcribe(audio)
  }

  @Get('placements/:id/review-hints')
  @Roles(Role.TUTOR, Role.COORDINATOR)
  reviewHints(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.service.reviewHints(id, req.user)
  }

  @Post('documents/:id/check')
  @Roles(Role.STUDENT, Role.TUTOR, Role.COORDINATOR)
  checkDocument(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.service.checkDocument(id, req.user)
  }
}
