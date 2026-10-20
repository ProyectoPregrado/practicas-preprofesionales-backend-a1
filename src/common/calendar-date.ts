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
