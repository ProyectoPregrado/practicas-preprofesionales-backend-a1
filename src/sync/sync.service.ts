import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { type Checkpoint, decodeCheckpoint, encodeCheckpoint } from './checkpoint'
import type { SyncOperationInput, SyncOperationResult } from './dto/push.dto'

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(userId: number, since: string | undefined, limit: number) {
    const cursor = decodeCheckpoint(since)

    // E1-05: cursor determinista con (updatedAt, id) — ni un registro se pierde
    // cuando múltiples comparten el mismo timestamp.
    const where = cursor
      ? {
          OR: [
            { updatedAt: { gt: new Date(cursor.updatedAt) } },
            { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } },
          ],
        }
      : {}

    const orderBy = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }]
    const scope = { placement: { OR: [{ studentId: userId }, { tutorId: userId }] } }

    const [placements, hourLogs, documents, evaluations] = await Promise.all([
      this.prisma.placement.findMany({
        where: { ...where, OR: [{ studentId: userId }, { tutorId: userId }] },
        orderBy,
        take: limit,
      }),
      this.prisma.hourLog.findMany({ where: { ...where, ...scope }, orderBy, take: limit }),
      this.prisma.document.findMany({ where: { ...where, ...scope }, orderBy, take: limit }),
      this.prisma.evaluation.findMany({ where: { ...where, ...scope }, orderBy, take: limit }),
    ])

    // E1-05: determinar el checkpoint con el mismo orden determinista (updatedAt, id).
    const allRows = [...placements, ...hourLogs, ...documents, ...evaluations]
    const newest = allRows.sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime() ||
        a.id - b.id,
    ).at(-1)

    const checkpoint: Checkpoint | null = newest
      ? { updatedAt: new Date(newest.updatedAt).toISOString(), id: newest.id }
      : cursor

    return {
      changes: { placements, hourLogs, documents, evaluations },
      checkpoint: checkpoint ? encodeCheckpoint(checkpoint) : null,
      hasMore: [placements, hourLogs, documents, evaluations].some((rows) => rows.length === limit),
    }
  }

  async push(userId: number, ops: SyncOperationInput[]) {
    const results: SyncOperationResult[] = []
    for (const op of ops) {
      // D-01: consultar sync_operations ANTES de aplicar — si ya se procesó
      // este clientOpId, devolver el resultado anterior sin re-aplicar.
      const existing = await this.prisma.syncOperation.findUnique({
        where: { clientOpId: op.clientOpId },
      })
      if (existing) {
        results.push(existing.response as unknown as SyncOperationResult)
        continue
      }

      let result: SyncOperationResult
      try {
        result = await this.applyOperation(userId, op)
      } catch (err) {
        result = {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: null,
          reason: err instanceof Error ? err.message : 'no se pudo aplicar la operación',
        }
      }
      await this.prisma.syncOperation.create({
        data: { clientOpId: op.clientOpId, userId, response: result as unknown as object },
      })
      results.push(result)
    }
    return { results }
  }

private async applyOperation(userId: number, op: SyncOperationInput): Promise<SyncOperationResult> {
    if (op.entity !== 'hourLog') {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'entidad no sincronizable desde el cliente' }
    }

    if (op.op === 'create') {
      return this.handleCreateHourLog(userId, op)
    }

    const existing = await this.prisma.hourLog.findUnique({
      where: { id: Number(op.payload.id) },
      include: { placement: true },
    })
    if (!existing || existing.placement.studentId !== userId) {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el registro no pertenece al usuario' }
    }

    // E1-04: Autoridad del servidor sobre registros resueltos por tutor
    if (existing.status === 'APPROVED' || existing.status === 'REJECTED') {
      return {
        clientOpId: op.clientOpId,
        status: 'rejected',
        server: existing as never,
        reason: `No se puede modificar una hora que ya fue resuelta por el tutor (${existing.status})`,
      }
    }

    if (op.op === 'update') {
      return this.handleUpdateHourLog(existing, op)
    }

    const deleted = await this.prisma.hourLog.update({
      where: { id: Number(op.payload.id) },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: deleted as never, reason: null }
  }

  private async handleCreateHourLog(userId: number, op: SyncOperationInput): Promise<SyncOperationResult> {
    const placement = await this.prisma.placement.findUnique({ where: { id: Number(op.payload.placementId) } })
    if (!placement || placement.studentId !== userId) {
      return { clientOpId: op.clientOpId, status: 'rejected', server: null, reason: 'el placement no pertenece al usuario' }
    }

    const created = await this.prisma.hourLog.create({
      data: {
        placementId: Number(op.payload.placementId),
        date: new Date(String(op.payload.date)),
        startTime: String(op.payload.startTime),
        endTime: String(op.payload.endTime),
        hours: Number(op.payload.hours),
        activity: String(op.payload.activity),
        status: 'SUBMITTED',
      },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: created as never, reason: null }
  }

  private async handleUpdateHourLog(existing: any, op: SyncOperationInput): Promise<SyncOperationResult> {
    // E1-04: Resolución basada en marca temporal más reciente cuando está en DRAFT o SUBMITTED
    if (op.payload.updatedAt) {
      const clientUpdatedAt = new Date(String(op.payload.updatedAt)).getTime()
      const serverUpdatedAt = new Date(existing.updatedAt).getTime()

      if (clientUpdatedAt < serverUpdatedAt) {
        return {
          clientOpId: op.clientOpId,
          status: 'rejected',
          server: existing as never,
          reason: 'Conflicto: la versión del servidor es más reciente que los cambios offline enviados',
        }
      }
    }

    const updated = await this.prisma.hourLog.update({
      where: { id: Number(op.payload.id) },
      data: {
        date: new Date(String(op.payload.date)),
        startTime: String(op.payload.startTime),
        endTime: String(op.payload.endTime),
        hours: Number(op.payload.hours),
        activity: String(op.payload.activity),
        version: { increment: 1 },
      },
    })
    return { clientOpId: op.clientOpId, status: 'applied', server: updated as never, reason: null }
  }
}
