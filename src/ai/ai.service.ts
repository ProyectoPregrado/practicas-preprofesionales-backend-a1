import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { formatDay } from '../common/calendar-date'
import { DocumentService } from '../document/document.service'
import { PrismaService } from '../prisma/prisma.service'
import { AiClient } from './ai-client'
import {
  CHECK_SCHEMA,
  CHECK_SYSTEM,
  type DocumentFinding,
  type ExtractedDocument,
  checkAgainstPlacement,
} from './document-check'
import { DRAFT_SCHEMA, DRAFT_SYSTEM, type HourLogDraft, type ModelDraft, basicDraft, finishDraft } from './hour-log-draft'
import { HINTS_SCHEMA, HINTS_SYSTEM, type ModelHints, type ReviewHint, mergeHints, ruleHints } from './review-hints'

interface Caller {
  sub: number
  role: Role
}

export interface ReviewHintsResult {
  aiUsed: boolean
  hints: ReviewHint[]
}

export interface DocumentCheckResult {
  aiUsed: boolean
  extracted: ExtractedDocument | null
  findings: DocumentFinding[]
}

/**
 * IA-1: el asistente de prácticas. Cada función intenta con Claude y, si la IA no está configurada o falla, responde
 * igual con su modo básico (reglas), marcando `aiUsed: false` para que la interfaz lo diga.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly ai: AiClient,
    private readonly prisma: PrismaService,
    private readonly documents: DocumentService,
  ) {}

  status() {
    return { enabled: this.ai.enabled }
  }

  /** El estudiante cuenta su día con sus palabras (o por voz) y recibe el registro listo para revisar y guardar. */
  async draftHourLog(text: string, today: string): Promise<HourLogDraft> {
    if (this.ai.enabled) {
      try {
        const raw = await this.ai.json<ModelDraft>({
          system: DRAFT_SYSTEM,
          schema: DRAFT_SCHEMA,
          content: [{ type: 'text', text: `Fecha de hoy: ${today}\n\nLo que contó la persona:\n${text}` }],
        })
        return finishDraft(raw, true)
      } catch (error) {
        this.logger.warn(`borrador sin IA: ${String(error)}`)
      }
    }
    return finishDraft(basicDraft(text, today), false)
  }

  /** Semáforo de los registros que esperan revisión de una práctica del tutor. */
  async reviewHints(placementId: number, caller: Caller): Promise<ReviewHintsResult> {
    const placement = await this.prisma.placement.findFirst({ where: { id: placementId, deletedAt: null } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (caller.role !== Role.COORDINATOR && placement.tutorId !== caller.sub) {
      throw new ForbiddenException('esta práctica está asignada a otro tutor')
    }

    const rows = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })
    const logs = rows.map((row) => ({
      id: row.id,
      date: formatDay(row.date),
      startTime: row.startTime,
      endTime: row.endTime,
      hours: row.hours,
      activity: row.activity,
      status: row.status,
    }))
    const rules = ruleHints(logs)
    const pending = logs.filter((log) => log.status === 'SUBMITTED')
    if (!this.ai.enabled || pending.length === 0) return { aiUsed: false, hints: rules }

    try {
      const model = await this.ai.json<ModelHints>({
        system: HINTS_SYSTEM,
        schema: HINTS_SCHEMA,
        content: [
          {
            type: 'text',
            text: `Registros por revisar (JSON):\n${JSON.stringify(
              pending.map(({ id, date, hours, activity }) => ({ logId: id, date, hours, activity })),
            )}`,
          },
        ],
      })
      return { aiUsed: true, hints: mergeHints(rules, model) }
    } catch (error) {
      this.logger.warn(`semáforo sin IA: ${String(error)}`)
      return { aiUsed: false, hints: rules }
    }
  }

  /** Lee el convenio o el seguro y lo compara con la práctica: vigencia, nombre y empresa. */
  async checkDocument(documentId: number, caller: Caller): Promise<DocumentCheckResult> {
    const { document, buffer, placement } = await this.documents.readFileWithPlacement(documentId, caller)
    if (!this.ai.enabled) {
      return {
        aiUsed: false,
        extracted: null,
        findings: [{ level: 'yellow', message: 'La revisión automática necesita la IA configurada en el servidor.' }],
      }
    }

    const data = buffer.toString('base64')
    const file =
      document.mimeType === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : ({
            type: 'image',
            source: { type: 'base64', media_type: document.mimeType as 'image/png' | 'image/jpeg', data },
          } as const)

    try {
      const extracted = await this.ai.json<ExtractedDocument>({
        system: CHECK_SYSTEM,
        schema: CHECK_SCHEMA,
        content: [file, { type: 'text', text: 'Extrae los datos de este documento.' }],
      })
      const findings = checkAgainstPlacement(extracted, {
        studentName: placement.student.fullName,
        companyName: placement.company.name,
        startDate: formatDay(placement.startDate),
        endDate: formatDay(placement.endDate),
        declaredKind: document.kind,
      })
      return { aiUsed: true, extracted, findings }
    } catch (error) {
      this.logger.warn(`revisión de documento sin IA: ${String(error)}`)
      return {
        aiUsed: false,
        extracted: null,
        findings: [{ level: 'yellow', message: 'La IA no está disponible en este momento; inténtalo de nuevo en un rato.' }],
      }
    }
  }
}
