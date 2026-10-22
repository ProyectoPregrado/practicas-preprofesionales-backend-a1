import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiClient } from './ai-client'
import { AiService } from './ai.service'

function setup(enabled: boolean) {
  const ai = { enabled, json: vi.fn() } as unknown as AiClient & { json: ReturnType<typeof vi.fn> }
  const prisma = {
    placement: { findFirst: vi.fn() },
    hourLog: { findMany: vi.fn() },
  }
  const documents = { readFileWithPlacement: vi.fn() }
  const service = new AiService(ai, prisma as never, documents as never)
  return { ai, prisma, documents, service }
}

const tutor = { sub: 2, role: Role.TUTOR }

describe('AiService (IA-1)', () => {
  let ctx: ReturnType<typeof setup>

  describe('borrador de horas', () => {
    it('con IA usa lo que devuelve Claude y lo valida', async () => {
      ctx = setup(true)
      ctx.ai.json.mockResolvedValue({
        date: '2026-10-20',
        startTime: '08:00',
        endTime: '12:00',
        activity: 'Configuré el servidor de pruebas.',
        followUp: '',
      })

      const draft = await ctx.service.draftHourLog('ayer de 8 a 12 el servidor', '2026-10-21')

      expect(draft).toMatchObject({ date: '2026-10-20', hours: 4, aiUsed: true, activity: 'Configuré el servidor de pruebas.' })
      expect(ctx.ai.json.mock.calls[0][0].content[0].text).toContain('Fecha de hoy: 2026-10-21')
    })

    it('si Claude falla, responde igual con el modo básico', async () => {
      ctx = setup(true)
      ctx.ai.json.mockRejectedValue(new ServiceUnavailableException('caída'))

      const draft = await ctx.service.draftHourLog('ayer de 8 a 12 configuré el servidor de pruebas', '2026-10-21')

      expect(draft).toMatchObject({ date: '2026-10-20', startTime: '08:00', endTime: '12:00', aiUsed: false })
    })

    it('sin clave no llama a Claude', async () => {
      ctx = setup(false)
      await ctx.service.draftHourLog('hoy de 9 a 13 revisé facturas del mes', '2026-10-21')
      expect(ctx.ai.json).not.toHaveBeenCalled()
    })
  })

  describe('semáforo', () => {
    beforeEach(() => {
      ctx = setup(true)
      ctx.prisma.placement.findFirst.mockResolvedValue({ id: 1, tutorId: 2 })
      ctx.prisma.hourLog.findMany.mockResolvedValue([
        { id: 10, date: new Date('2026-03-02T00:00:00Z'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'apoyo', status: 'SUBMITTED' },
        { id: 11, date: new Date('2026-03-03T00:00:00Z'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollé el reporte mensual de ventas en Excel', status: 'SUBMITTED' },
        { id: 12, date: new Date('2026-03-01T00:00:00Z'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Inducción con el equipo de TI y entrega de equipos', status: 'APPROVED' },
      ])
    })

    it('envía a Claude solo los registros sin revisar y junta su juicio con las reglas', async () => {
      ctx.ai.json.mockResolvedValue({ items: [{ logId: 11, clarity: 'vague', reason: 'No dice para qué.', note: '¿Para qué área?' }] })

      const result = await ctx.service.reviewHints(1, tutor)

      expect(result.aiUsed).toBe(true)
      expect(result.hints.map((hint) => [hint.logId, hint.level])).toEqual([
        [10, 'yellow'],
        [11, 'yellow'],
      ])
      const sent = JSON.parse(ctx.ai.json.mock.calls[0][0].content[0].text.split('\n').slice(1).join('\n'))
      expect(sent.map((item: { logId: number }) => item.logId)).toEqual([10, 11])
    })

    it('si Claude falla, devuelve solo las reglas y lo dice', async () => {
      ctx.ai.json.mockRejectedValue(new ServiceUnavailableException('caída'))
      const result = await ctx.service.reviewHints(1, tutor)
      expect(result).toMatchObject({ aiUsed: false })
      expect(result.hints.map((hint) => hint.level)).toEqual(['yellow', 'green'])
    })

    it('otro tutor no puede pedir el semáforo, y una plaza inexistente da 404', async () => {
      await expect(ctx.service.reviewHints(1, { sub: 99, role: Role.TUTOR })).rejects.toBeInstanceOf(ForbiddenException)
      ctx.prisma.placement.findFirst.mockResolvedValue(null)
      await expect(ctx.service.reviewHints(1, tutor)).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('revisar documento', () => {
    const file = {
      document: { kind: 'INSURANCE', mimeType: 'application/pdf' },
      buffer: Buffer.from('%PDF-1.7'),
      placement: {
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-07-31T00:00:00Z'),
        student: { fullName: 'Ana Pérez' },
        company: { name: 'Empresa Andina' },
      },
    }

    it('manda el PDF a Claude y compara lo leído con la práctica', async () => {
      ctx = setup(true)
      ctx.documents.readFileWithPlacement.mockResolvedValue(file)
      ctx.ai.json.mockResolvedValue({
        documentType: 'INSURANCE',
        personName: 'Ana Pérez',
        companyName: 'Empresa Andina',
        validFrom: '2026-01-01',
        validTo: '2026-06-30',
        policyNumber: 'P-1',
        summary: 'Póliza',
      })

      const result = await ctx.service.checkDocument(5, tutor)

      expect(ctx.ai.json.mock.calls[0][0].content[0]).toMatchObject({ type: 'file', mimeType: 'application/pdf' })
      expect(result.aiUsed).toBe(true)
      expect(result.findings[0]).toMatchObject({ level: 'red' })
    })

    it('sin IA no inventa una revisión: lo dice', async () => {
      ctx = setup(false)
      ctx.documents.readFileWithPlacement.mockResolvedValue(file)
      const result = await ctx.service.checkDocument(5, tutor)
      expect(result).toMatchObject({ aiUsed: false, extracted: null })
      expect(result.findings[0].message).toMatch(/necesita la IA/)
    })
  })
})
