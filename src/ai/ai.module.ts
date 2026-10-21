import { Module } from '@nestjs/common'
import { DocumentModule } from '../document/document.module'
import { AiClient } from './ai-client'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'

@Module({
  imports: [DocumentModule],
  controllers: [AiController],
  providers: [AiClient, AiService],
})
export class AiModule {}
