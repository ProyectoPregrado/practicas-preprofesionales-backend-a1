import { getMaxHoursPerDay } from '../hour-log/hour-rules'

export type HintLevel = 'green' | 'yellow' | 'red'

/** Lo que el semáforo necesita de cada registro. */
export interface ReviewLog {
  id: number
  /** `AAAA-MM-DD`. */
  date: string
  startTime: string
  endTime: string
  hours: number
  activity: string
  status: string
}

export interface ReviewHint {
  logId: number
  level: HintLevel
  /** Por qué no está en verde; vacío si está bien. */
  reasons: string[]
  /** Nota de devolución lista para editar; vacía en verde. */
  suggestedNote: string
}

const RANK: Record<HintLevel, number> = { green: 0, yellow: 1, red: 2 }

export function worst(a: HintLevel, b: HintLevel): HintLevel {
  return RANK[a] >= RANK[b] ? a : b
}

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Señales que no necesitan IA, sobre los registros que esperan revisión: días con más horas de las permitidas,
 * horarios que se pisan, actividades muy cortas y textos repetidos. Cuentan todos los registros vigentes del día
 * (no los rechazados), porque un registro aprobado también ocupa ese horario.
 */
export function ruleHints(logs: ReviewLog[], env: NodeJS.ProcessEnv = process.env): ReviewHint[] {
  const maxPerDay = getMaxHoursPerDay(env)
  const active = logs.filter((log) => log.status !== 'REJECTED')
  const byDay = new Map<string, ReviewLog[]>()
  for (const log of active) byDay.set(log.date, [...(byDay.get(log.date) ?? []), log])
  const textCount = new Map<string, number>()
  for (const log of active) {
    const key = normalize(log.activity)
    textCount.set(key, (textCount.get(key) ?? 0) + 1)
  }

  return logs
    .filter((log) => log.status === 'SUBMITTED')
    .map((log) => {
      const reasons: string[] = []
      let level: HintLevel = 'green'
      const sameDay = byDay.get(log.date) ?? []
      const dayTotal = sameDay.reduce((sum, other) => sum + other.hours, 0)
      if (dayTotal > maxPerDay) {
        level = 'red'
        reasons.push(`Ese día suma ${dayTotal} h y el máximo es ${maxPerDay} h.`)
      }
      const overlaps = sameDay.some(
        (other) =>
          other.id !== log.id &&
          toMinutes(other.startTime) < toMinutes(log.endTime) &&
          toMinutes(log.startTime) < toMinutes(other.endTime),
      )
      if (overlaps) {
        level = 'red'
        reasons.push('El horario se cruza con otro registro del mismo día.')
      }
      if (log.activity.trim().split(/\s+/).length < 5) {
        level = worst(level, 'yellow')
        reasons.push('La actividad es muy corta para saber qué se hizo.')
      }
      if ((textCount.get(normalize(log.activity)) ?? 0) > 1) {
        level = worst(level, 'yellow')
        reasons.push('La actividad está escrita igual en otro registro.')
      }
      return { logId: log.id, level, reasons, suggestedNote: reasons.length ? suggestedNoteFor(reasons) : '' }
    })
}

function suggestedNoteFor(reasons: string[]): string {
  return `Por favor revisa este registro: ${reasons.map((reason) => reason.charAt(0).toLowerCase() + reason.slice(1)).join(' ')}`
}

export const HINTS_SYSTEM = [
  'Ayudas a un tutor académico a revisar el libro de horas de un estudiante de prácticas preprofesionales.',
  'Para cada registro decide si la actividad describe con claridad un trabajo concreto propio de una práctica.',
  '- clear: se entiende qué se hizo (por ejemplo «Configuré el servidor de pruebas y documenté la instalación»).',
  '- vague: no se entiende qué se hizo o es genérica («apoyo», «tareas varias», «lo mismo de ayer»).',
  'Si es vague, escribe en reason por qué en una frase y en note una nota breve y amable para el estudiante, con tuteo, pidiendo el detalle que falta. Si es clear, reason y note vacíos.',
  'Juzga solo la descripción: las horas y los horarios ya los revisa otro paso.',
].join('\n')

export const HINTS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          logId: { type: 'integer' },
          clarity: { type: 'string', enum: ['clear', 'vague'] },
          reason: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['logId', 'clarity', 'reason', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

export type ModelHints = { items: { logId: number; clarity: 'clear' | 'vague'; reason: string; note: string }[] }

/** Junta las señales de reglas con el juicio de la IA sobre la descripción: gana el color más grave. */
export function mergeHints(rules: ReviewHint[], model: ModelHints | null): ReviewHint[] {
  const byId = new Map(model?.items.map((item) => [item.logId, item]) ?? [])
  return rules.map((hint) => {
    const item = byId.get(hint.logId)
    if (!item || item.clarity === 'clear') return hint
    const reasons = item.reason && !hint.reasons.includes(item.reason) ? [...hint.reasons, item.reason] : hint.reasons
    return {
      logId: hint.logId,
      level: worst(hint.level, 'yellow'),
      reasons,
      suggestedNote: item.note || hint.suggestedNote,
    }
  })
}
