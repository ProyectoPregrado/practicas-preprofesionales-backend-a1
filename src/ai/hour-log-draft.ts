import { hoursRangeError, timeOrderError } from '../hour-log/hour-rules'

/** Borrador de un registro de horas a partir de lo que la persona contó con sus palabras. */
export interface HourLogDraft {
  /** `AAAA-MM-DD`, o vacío si no se pudo saber. */
  date: string
  /** `HH:MM`, o vacío. */
  startTime: string
  endTime: string
  hours: number | null
  activity: string
  /** Qué falta o qué conviene precisar antes de enviar; vacío si está completo. */
  followUp: string
  /** Problemas con las reglas del libro (horario al revés, más horas de las permitidas). */
  warnings: string[]
  aiUsed: boolean
}

export const DRAFT_SYSTEM = [
  'Ayudas a estudiantes de prácticas preprofesionales en Ecuador a llenar su libro de horas.',
  'Recibes lo que la persona contó de su día y la fecha de hoy. Devuelve:',
  '- date: la fecha del trabajo en formato AAAA-MM-DD. Resuelve «hoy», «ayer», «el lunes» respecto de la fecha de hoy. Si no se menciona, usa hoy.',
  '- startTime y endTime en formato HH:MM de 24 horas. «De 8 a 12» es 08:00 a 12:00; «de 2 a 6 de la tarde» es 14:00 a 18:00. Vacío si no se menciona.',
  '- activity: la actividad redactada para que la lea el tutor, en español neutro y con tuteo, en una o dos frases concretas: qué se hizo y con qué resultado. No inventes datos que la persona no dijo.',
  '- followUp: si la actividad es vaga («hice cosas», «ayudé») o falta el horario, una pregunta corta para completarla; si no falta nada, cadena vacía.',
].join('\n')

export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    activity: { type: 'string' },
    followUp: { type: 'string' },
  },
  required: ['date', 'startTime', 'endTime', 'activity', 'followUp'],
  additionalProperties: false,
} as const

export type ModelDraft = { date: string; startTime: string; endTime: string; activity: string; followUp: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + delta))
  return date.toISOString().slice(0, 10)
}

/** Horas entre dos horarios válidos, con las advertencias de las reglas del libro. */
function hoursBetween(startTime: string, endTime: string): { hours: number | null; warnings: string[] } {
  if (!startTime || !endTime) return { hours: null, warnings: [] }
  const order = timeOrderError(startTime, endTime)
  if (order) return { hours: null, warnings: [order] }
  const hours = Math.round(((minutes(endTime) - minutes(startTime)) / 60) * 100) / 100
  const range = hoursRangeError(hours)
  return { hours, warnings: range ? [range] : [] }
}

/**
 * Valida y completa lo que propuso el modelo (o el modo básico): descarta formatos inválidos, calcula las horas y
 * revisa las reglas del libro. El servidor vuelve a validar al guardar; esto solo avisa antes.
 */
export function finishDraft(raw: ModelDraft, aiUsed: boolean): HourLogDraft {
  const date = DAY.test(raw.date) ? raw.date : ''
  const startTime = TIME.test(raw.startTime) ? raw.startTime : ''
  const endTime = TIME.test(raw.endTime) ? raw.endTime : ''
  const { hours, warnings } = hoursBetween(startTime, endTime)
  const missingTimes = !startTime || !endTime
  const followUp = raw.followUp.trim() || (missingTimes ? '¿A qué hora empezaste y a qué hora terminaste?' : '')
  return { date, startTime, endTime, hours, activity: raw.activity.trim(), followUp, warnings, aiUsed }
}

const pad = (value: number): string => String(value).padStart(2, '0')

function dayOffset(lower: string): number {
  if (/\banteayer\b/.test(lower)) return -2
  if (/\bayer\b/.test(lower)) return -1
  return 0
}

/** Los dos primeros horarios del texto («8», «12:30»), pasados a 24 horas si se habla de la tarde o la noche. */
function timesIn(lower: string): [string, string] {
  const found = [...lower.matchAll(/\b(\d{1,2})(?::(\d{2}))?\b/g)]
    .map((match) => ({ hour: Number(match[1]), minute: Number(match[2] ?? 0) }))
    .filter(({ hour, minute }) => hour <= 23 && minute <= 59)
  if (found.length < 2) return ['', '']
  const [start, end] = found
  const afternoon = /tarde|noche|\bpm\b|p\.m\./.test(lower)
  const endHour = afternoon && end.hour < 12 ? end.hour + 12 : end.hour
  const startHour = afternoon && start.hour < 12 && start.hour + 12 <= endHour ? start.hour + 12 : start.hour
  return [`${pad(startHour)}:${pad(start.minute)}`, `${pad(endHour)}:${pad(end.minute)}`]
}

/**
 * Modo básico sin IA: reconoce «hoy», «ayer» y «anteayer», los dos primeros horarios («de 8 a 12», «2 a 6 de la
 * tarde») y deja el texto como actividad. Sirve cuando no hay clave o la API no responde.
 */
export function basicDraft(text: string, today: string): ModelDraft {
  const lower = text.toLowerCase()
  const [startTime, endTime] = timesIn(lower)
  const activity = text.trim().replace(/\s+/g, ' ')
  const vague = activity.split(' ').length < 5
  return {
    date: addDays(today, dayOffset(lower)),
    startTime,
    endTime,
    activity,
    followUp: vague ? 'Cuenta un poco más: ¿qué hiciste y para qué?' : '',
  }
}
