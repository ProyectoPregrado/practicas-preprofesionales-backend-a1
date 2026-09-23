import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { EvaluationKind, Role } from '@prisma/client'
import { EvaluationService } from './evaluation.service'
import type { CreateEvaluationDto } from './dto/create-evaluation.dto'

const prisma = {
  placement: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  evaluation: { create: vi.fn(), findMany: vi.fn() },
}

describe('EvaluationService', () => {
  let service: EvaluationService

  const placement = {
    id: 1,
    studentId: 10,
    tutorId: 20,
    companyId: 3,
    status: 'ACTIVE',
    deletedAt: null,
  }

  const scores = { technical: 4, communication: 5, punctuality: 3 }

  const validDto: CreateEvaluationDto = {
    placementId: 1,
    kind: EvaluationKind.TUTOR,
    period: '2026-03',
    scores,
    comment: 'Buen desempeño',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.placement.findUnique.mockResolvedValue(placement)
    prisma.user.findUnique.mockResolvedValue({ id: 20, companyId: 3 })
    // evaluation.create retorna el kind del dto real (Prisma pasa { data: {...} })
    prisma.evaluation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, ...data, submittedAt: new Date() }),
    )
    prisma.evaluation.findMany.mockResolvedValue([])
    service = new EvaluationService(prisma as never)
  })

  // -------------------------------------------------------------------------
  // submit — tutor
  // -------------------------------------------------------------------------

  it('un tutor puede enviar una evaluación TUTOR para su placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, tutorId: 20 })

    const result = await service.submit(validDto, 20, Role.TUTOR)

    expect(result.kind).toBe(EvaluationKind.TUTOR)
    expect(prisma.evaluation.create).toHaveBeenCalledTimes(1)
  })

  it('un tutor no puede enviar una evaluación de tipo COMPANY', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, tutorId: 20 })

    await expect(
      service.submit({ ...validDto, kind: EvaluationKind.COMPANY }, 20, Role.TUTOR),
    ).rejects.toThrow(ForbiddenException)
  })

  it('un tutor no puede enviar una evaluación de otro tutor', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, tutorId: 99 })

    await expect(
      service.submit(validDto, 20, Role.TUTOR),
    ).rejects.toThrow(ForbiddenException)
  })

  // -------------------------------------------------------------------------
  // submit — company
  // -------------------------------------------------------------------------

  it('una empresa puede enviar una evaluación COMPANY para su placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, companyId: 3 })
    prisma.user.findUnique.mockResolvedValue({ id: 30, companyId: 3 })

    const result = await service.submit(
      { ...validDto, kind: EvaluationKind.COMPANY },
      30,
      Role.COMPANY,
    )

    expect(result.kind).toBe(EvaluationKind.COMPANY)
    expect(prisma.evaluation.create).toHaveBeenCalledTimes(1)
  })

  it('una empresa no puede enviar una evaluación de tipo TUTOR', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, companyId: 3 })
    prisma.user.findUnique.mockResolvedValue({ id: 30, companyId: 3 })

    await expect(
      service.submit({ ...validDto, kind: EvaluationKind.TUTOR }, 30, Role.COMPANY),
    ).rejects.toThrow(ForbiddenException)
  })

  it('una empresa no puede evaluar un placement de otra empresa', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, companyId: 99 })
    prisma.user.findUnique.mockResolvedValue({ id: 30, companyId: 3 })

    await expect(
      service.submit({ ...validDto, kind: EvaluationKind.COMPANY }, 30, Role.COMPANY),
    ).rejects.toThrow(ForbiddenException)
  })

  // -------------------------------------------------------------------------
  // submit — student
  // -------------------------------------------------------------------------

  it('un estudiante puede enviar una autoevaluación SELF para su placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, studentId: 10 })

    const result = await service.submit(
      { ...validDto, kind: EvaluationKind.SELF },
      10,
      Role.STUDENT,
    )

    expect(result.kind).toBe(EvaluationKind.SELF)
    expect(prisma.evaluation.create).toHaveBeenCalledTimes(1)
  })

  it('un estudiante no puede enviar una evaluación de tipo TUTOR', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, studentId: 10 })

    await expect(
      service.submit({ ...validDto, kind: EvaluationKind.TUTOR }, 10, Role.STUDENT),
    ).rejects.toThrow(ForbiddenException)
  })

  it('un estudiante no puede evaluar el placement de otro estudiante', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, studentId: 99 })

    await expect(
      service.submit({ ...validDto, kind: EvaluationKind.SELF }, 10, Role.STUDENT),
    ).rejects.toThrow(ForbiddenException)
  })

  // -------------------------------------------------------------------------
  // submit — rol no autorizado
  // -------------------------------------------------------------------------

  it('un coordinador no puede enviar evaluaciones', async () => {
    await expect(
      service.submit(validDto, 5, Role.COORDINATOR),
    ).rejects.toThrow(ForbiddenException)
  })

  // -------------------------------------------------------------------------
  // submit — placement no encontrado
  // -------------------------------------------------------------------------

  it('lanza NotFoundException si el placement no existe', async () => {
    prisma.placement.findUnique.mockResolvedValue(null)

    await expect(
      service.submit(validDto, 20, Role.TUTOR),
    ).rejects.toThrow(NotFoundException)
  })

  // -------------------------------------------------------------------------
  // listForPlacement
  // -------------------------------------------------------------------------

  it('el estudiante puede listar las evaluaciones de su placement', async () => {
    const evaluations = [
      { id: 1, kind: EvaluationKind.TUTOR, placementId: 1 },
      { id: 2, kind: EvaluationKind.SELF, placementId: 1 },
    ]
    prisma.evaluation.findMany.mockResolvedValue(evaluations)

    const result = await service.listForPlacement(1, 10, Role.STUDENT)

    expect(result).toHaveLength(2)
  })

  it('el tutor puede listar las evaluaciones del placement que supervisa', async () => {
    const evaluations = [{ id: 1, kind: EvaluationKind.SELF, placementId: 1 }]
    prisma.evaluation.findMany.mockResolvedValue(evaluations)

    const result = await service.listForPlacement(1, 20, Role.TUTOR)

    expect(result).toHaveLength(1)
  })

  it('el coordinador puede listar cualquier evaluación', async () => {
    const evaluations = [
      { id: 1, kind: EvaluationKind.TUTOR, placementId: 1 },
      { id: 2, kind: EvaluationKind.COMPANY, placementId: 1 },
      { id: 3, kind: EvaluationKind.SELF, placementId: 1 },
    ]
    prisma.evaluation.findMany.mockResolvedValue(evaluations)

    const result = await service.listForPlacement(1, 5, Role.COORDINATOR)

    expect(result).toHaveLength(3)
  })

  it('lanza ForbiddenException si un estudiante intenta ver evaluaciones ajenas', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, studentId: 99 })

    await expect(
      service.listForPlacement(1, 10, Role.STUDENT),
    ).rejects.toThrow(ForbiddenException)
  })

  it('lanza ForbiddenException si un tutor intenta ver evaluaciones de otro placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ ...placement, tutorId: 99 })

    await expect(
      service.listForPlacement(1, 20, Role.TUTOR),
    ).rejects.toThrow(ForbiddenException)
  })

  it('lanza NotFoundException si el placement no existe en listForPlacement', async () => {
    prisma.placement.findUnique.mockResolvedValue(null)

    await expect(
      service.listForPlacement(1, 10, Role.STUDENT),
    ).rejects.toThrow(NotFoundException)
  })

  it('no devuelve evaluaciones eliminadas (deletedAt is not null)', async () => {
    // El mock recibe el where con deletedAt: null y debe filtrar según eso.
    // Simulamos lo que Prisma haría: retornar solo las no eliminadas.
    prisma.evaluation.findMany.mockImplementation(async ({ where }: { where: { deletedAt: null } }) => {
      if (where?.deletedAt === null) {
        return [{ id: 1, kind: EvaluationKind.TUTOR, placementId: 1, deletedAt: null }]
      }
      return []
    })

    const result = await service.listForPlacement(1, 10, Role.STUDENT)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('ordena las evaluaciones por submittedAt descendente', async () => {
    prisma.evaluation.findMany.mockResolvedValue([])

    await service.listForPlacement(1, 10, Role.STUDENT)

    expect(prisma.evaluation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { submittedAt: 'desc' } }),
    )
  })
})
