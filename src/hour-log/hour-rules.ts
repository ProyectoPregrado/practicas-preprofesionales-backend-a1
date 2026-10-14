import { HourLogStatus, type Prisma, type PrismaClient } from '@prisma/client'

// E6-01 / D-06: una sola definición de la regla de horas. Antes vivía en tres sitios con tres
// topes distintos (DTO 12, servicio 10, formulario 8). La coordinación definió el tope: 8 horas por
// día, sumando todos los registros del estudiante en esa fecha, igual para todas las carreras.
export const MIN_HOURS_PER_LOG = 0.5
const DEFAULT_MAX_HOURS_PER_DAY = 8

export function getMaxHoursPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.MAX_HOURS_PER_DAY)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_HOURS_PER_DAY
}

export function hoursRangeMessage(): string {
  return `las horas de un registro deben estar entre ${MIN_HOURS_PER_LOG} y ${getMaxHoursPerDay()}`
}

export function hoursRangeError(hours: number): string | null {
  return hours >= MIN_HOURS_PER_LOG && hours <= getMaxHoursPerDay() ? null : hoursRangeMessage()
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function timeOrderError(startTime: string, endTime: string): string | null {
  return toMinutes(startTime) < toMinutes(endTime) ? null : 'la hora de inicio debe ser anterior a la de fin'
}

type HourLogDb = Pick<PrismaClient | Prisma.TransactionClient, 'hourLog'>

function utcDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

// Suma lo ya registrado por el estudiante ese día (todos sus placements) y rechaza si se pasa del
// tope. No cuenta registros rechazados por el tutor ni borrados; `excludeId` deja editar un registro
// sin contarse a sí mismo.
export async function dailyHoursError(
  db: HourLogDb,
  studentId: number,
  date: Date,
  newHours: number,
  excludeId?: number,
): Promise<string | null> {
  const { start, end } = utcDayBounds(date)
  const result = await db.hourLog.aggregate({
    _sum: { hours: true },
    where: {
      placement: { studentId },
      date: { gte: start, lt: end },
      deletedAt: null,
      status: { not: HourLogStatus.REJECTED },
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
    },
  })
  const already = result._sum.hours ?? 0
  const max = getMaxHoursPerDay()
  if (already + newHours <= max) return null
  return `el total del día no puede superar ${max} horas (ya tienes ${already} registradas el ${start.toISOString().slice(0, 10)})`
}

// Serializa por estudiante las escrituras que suman horas: sin esto, dos registros simultáneos del
// mismo día leen la misma suma y los dos pasan (la misma ventana de E2-01). El bloqueo se libera al
// terminar la transacción.
export function withStudentHoursLock<T>(
  prisma: PrismaClient,
  studentId: number,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${studentId})`
    return work(tx)
  })
}
