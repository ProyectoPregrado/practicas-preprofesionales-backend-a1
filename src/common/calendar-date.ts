// E6-02: una fecha de negocio (inicio de plaza, fecha de un registro de horas) es un DÍA CALENDARIO, no
// un instante. Se guarda como medianoche UTC ('2026-03-01' → 2026-03-01T00:00:00.000Z) y toda
// comparación o agrupación se hace en UTC. Nunca con los getters locales (getDate, getMonth,
// getFullYear) ni con `new Date(año, mes, día)`: dependen de la zona del servidor y corren el día.

// Límites de un período de acreditación 'AAAA-1' (enero a junio) o 'AAAA-2' (julio a diciembre):
// desde el primer día inclusive hasta el primer día del período siguiente exclusive.
export function periodBounds(period: string): { from: Date; to: Date } {
  const [year, term] = period.split('-')
  const firstTerm = term === '1'
  return {
    from: new Date(Date.UTC(Number(year), firstTerm ? 0 : 6, 1)),
    to: new Date(Date.UTC(Number(year), firstTerm ? 6 : 12, 1)),
  }
}

// Semana ISO 8601 ('AAAA-Www') del día calendario de `date`.
export function isoWeekLabel(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

  // Lunes = 1 ... domingo = 7, para mover la fecha al jueves de la misma semana ISO.
  const isoDayNumber = copy.getUTCDay() === 0 ? 7 : copy.getUTCDay()
  copy.setUTCDate(copy.getUTCDate() + 4 - isoDayNumber)

  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1))
  const daysSinceYearStart = (copy.getTime() - yearStart.getTime()) / 86400000
  const weekNumber = Math.ceil((daysSinceYearStart + 1) / 7)

  return `${copy.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`
}

// --- Normalización de lo que envía un cliente (E6-02) ---

const DEFAULT_INSTITUTION_TIME_ZONE = 'America/Guayaquil'

// Zona horaria de la institución: define a qué día calendario pertenece un instante y qué es «hoy».
// Configurable con INSTITUTION_TIME_ZONE (nombre IANA); una zona inválida falla con un mensaje claro.
export function getInstitutionTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const zone = env.INSTITUTION_TIME_ZONE?.trim() || DEFAULT_INSTITUTION_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
  } catch {
    throw new Error(`INSTITUTION_TIME_ZONE no es una zona horaria válida: "${zone}" (ej. America/Guayaquil)`)
  }
  return zone
}

// Día calendario (medianoche UTC) que corresponde a un instante visto desde la zona dada.
export function calendarDayInZone(instant: Date, zone: string): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  )
  return new Date(`${day}T00:00:00.000Z`)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Normaliza la fecha que manda un cliente a un día calendario (medianoche UTC):
// - 'AAAA-MM-DD' ya es un día y se respeta tal cual, sin importar la zona del dispositivo;
// - un instante (con hora y offset) se lleva a la zona de la institución, así el mismo instante da el
//   mismo día desde cualquier dispositivo;
// - cualquier otra cosa da `Invalid Date`, que el validador del DTO rechaza.
export function normalizeCalendarDay(value: unknown, zone: string = getInstitutionTimeZone()): Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date(NaN) : calendarDayInZone(value, zone)
  if (typeof value !== 'string') return new Date(NaN)
  const text = value.trim()
  if (DATE_ONLY.test(text)) {
    // Date acepta '2026-02-31' y lo corre al 3 de marzo: se exige que el día no cambie al normalizarlo.
    const day = new Date(`${text}T00:00:00.000Z`)
    return !Number.isNaN(day.getTime()) && formatDay(day) === text ? day : new Date(NaN)
  }
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? new Date(NaN) : calendarDayInZone(instant, zone)
}

// 'AAAA-MM-DD' de un día calendario.
export function formatDay(day: Date): string {
  return day.toISOString().slice(0, 10)
}
