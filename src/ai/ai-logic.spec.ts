import { describe, expect, it } from 'vitest'
import { checkAgainstPlacement, namesMatch, type ExtractedDocument, type PlacementFacts } from './document-check'
import { basicDraft, finishDraft } from './hour-log-draft'
import { mergeHints, ruleHints, type ReviewLog } from './review-hints'

describe('IA-1: borrador de registro de horas', () => {
  it('el modo básico entiende «ayer de 8 a 12» y deja el texto como actividad', () => {
    const raw = basicDraft('Ayer de 8 a 12 configuré el servidor de pruebas de la empresa', '2026-10-21')
    expect(raw).toMatchObject({ date: '2026-10-20', startTime: '08:00', endTime: '12:00' })
    expect(raw.activity).toBe('Ayer de 8 a 12 configuré el servidor de pruebas de la empresa')
    expect(raw.followUp).toBe('')
  })

  it('pasa la tarde a 24 horas y acepta minutos', () => {
    expect(basicDraft('Hoy de 2 a 6:30 de la tarde documenté la red', '2026-10-21')).toMatchObject({
      date: '2026-10-21',
      startTime: '14:00',
      endTime: '18:30',
    })
  })

  it('«anteayer» no se confunde con «ayer»', () => {
    expect(basicDraft('anteayer de 9 a 11 reunión de equipo y planificación', '2026-10-21').date).toBe('2026-10-19')
  })

  it('pide más detalle si la actividad es muy corta o falta el horario', () => {
    expect(basicDraft('hice cosas', '2026-10-21').followUp).toMatch(/Cuenta un poco más/)
    expect(finishDraft({ date: '2026-10-21', startTime: '', endTime: '', activity: 'Soporte técnico al área contable', followUp: '' }, false).followUp).toBe(
      '¿A qué hora empezaste y a qué hora terminaste?',
    )
  })

  it('calcula las horas y avisa si el horario está al revés o pasa del máximo por registro', () => {
    const ok = finishDraft({ date: '2026-10-21', startTime: '08:00', endTime: '12:30', activity: 'x', followUp: '' }, true)
    expect(ok).toMatchObject({ hours: 4.5, warnings: [], aiUsed: true })
    expect(finishDraft({ date: '2026-10-21', startTime: '12:00', endTime: '08:00', activity: 'x', followUp: '' }, true).warnings).toHaveLength(1)
    expect(finishDraft({ date: '2026-10-21', startTime: '06:00', endTime: '20:00', activity: 'x', followUp: '' }, true).warnings).toHaveLength(1)
  })

  it('descarta fechas y horas con formato inválido en lugar de pasarlas al formulario', () => {
    const draft = finishDraft({ date: '21/10/2026', startTime: '8', endTime: '25:00', activity: ' Algo ', followUp: '' }, true)
    expect(draft).toMatchObject({ date: '', startTime: '', endTime: '', hours: null, activity: 'Algo' })
  })
})

const log = (id: number, extra: Partial<ReviewLog> = {}): ReviewLog => ({
  id,
  date: '2026-03-02',
  startTime: '08:00',
  endTime: '12:00',
  hours: 4,
  activity: `Desarrollé el módulo ${id} del sistema de inventario y sus pruebas`,
  status: 'SUBMITTED',
  ...extra,
})

describe('IA-1: semáforo del tutor', () => {
  it('un registro claro, sin cruces y dentro del máximo queda en verde', () => {
    expect(ruleHints([log(1)])).toEqual([{ logId: 1, level: 'green', reasons: [], suggestedNote: '' }])
  })

  it('marca en rojo los días con más horas de las permitidas y los horarios que se cruzan', () => {
    const hints = ruleHints([
      log(1, { startTime: '08:00', endTime: '13:00', hours: 5 }),
      log(2, { startTime: '12:00', endTime: '17:00', hours: 5 }),
    ])
    expect(hints.map((hint) => hint.level)).toEqual(['red', 'red'])
    expect(hints[0].reasons.join(' ')).toMatch(/suma 10 h y el máximo es 8 h/)
    expect(hints[0].reasons.join(' ')).toMatch(/se cruza/)
    expect(hints[0].suggestedNote).toMatch(/^Por favor revisa este registro/)
  })

  it('marca en amarillo las actividades muy cortas o repetidas, y los rechazados no cuentan', () => {
    const hints = ruleHints([
      log(1, { activity: 'apoyo', date: '2026-03-03' }),
      log(2, { activity: 'Lo mismo de siempre en la oficina', date: '2026-03-04' }),
      log(3, { activity: 'lo mismo de siempre en la oficina', date: '2026-03-05' }),
      log(4, { status: 'REJECTED', startTime: '09:00', endTime: '11:00', hours: 2 }),
    ])
    expect(hints.map((hint) => [hint.logId, hint.level])).toEqual([
      [1, 'yellow'],
      [2, 'yellow'],
      [3, 'yellow'],
    ])
  })

  it('la IA puede subir un verde a amarillo con su motivo y su nota, pero nunca bajar un rojo', () => {
    const rules = ruleHints([log(1), log(2, { date: '2026-03-03', startTime: '06:00', endTime: '15:00', hours: 9 })])
    const merged = mergeHints(rules, {
      items: [
        { logId: 1, clarity: 'vague', reason: 'No dice qué módulo ni qué resultado.', note: '¿Qué parte terminaste?' },
        { logId: 2, clarity: 'clear', reason: '', note: '' },
      ],
    })
    expect(merged[0]).toMatchObject({ level: 'yellow', suggestedNote: '¿Qué parte terminaste?' })
    expect(merged[0].reasons).toContain('No dice qué módulo ni qué resultado.')
    expect(merged[1].level).toBe('red')
  })

  it('sin respuesta de la IA quedan solo las reglas', () => {
    const rules = ruleHints([log(1)])
    expect(mergeHints(rules, null)).toEqual(rules)
  })
})

const facts: PlacementFacts = {
  studentName: 'Ana María Pérez Loor',
  companyName: 'Empresa Andina S.A.',
  startDate: '2026-03-01',
  endDate: '2026-07-31',
  declaredKind: 'INSURANCE',
}

const doc = (extra: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  documentType: 'INSURANCE',
  personName: 'Ana Pérez',
  companyName: 'Empresa Andina',
  validFrom: '2026-02-15',
  validTo: '2026-12-31',
  policyNumber: 'P-123',
  summary: 'Póliza de accidentes',
  ...extra,
})

describe('IA-1: revisar convenio y seguro', () => {
  it('compara nombres sin importar tildes ni nombres intermedios', () => {
    expect(namesMatch('ANA PEREZ', 'Ana María Pérez Loor')).toBe(true)
    expect(namesMatch('Carlos Ruiz', 'Ana María Pérez Loor')).toBe(false)
  })

  it('un seguro vigente durante toda la práctica y a su nombre sale en verde', () => {
    expect(checkAgainstPlacement(doc(), facts)).toEqual([
      { level: 'green', message: 'Coincide con la práctica: nombre, empresa y vigencia.' },
    ])
  })

  it('avisa en rojo si vence antes de que termine la práctica, y eso va primero', () => {
    const findings = checkAgainstPlacement(doc({ validTo: '2026-06-30', personName: 'Carlos Ruiz' }), facts)
    expect(findings[0]).toEqual({ level: 'red', message: 'Vence el 2026-06-30, antes de que termine la práctica (2026-07-31).' })
    expect(findings[1].message).toMatch(/a nombre de «Carlos Ruiz»/)
  })

  it('avisa si se subió como seguro pero es un convenio, y si no aparece la fecha de vencimiento', () => {
    const findings = checkAgainstPlacement(doc({ documentType: 'AGREEMENT', validTo: '' }), facts)
    expect(findings.map((finding) => finding.message)).toEqual([
      'Se subió como seguro, pero el documento parece un convenio.',
      'No se encontró la fecha de vencimiento en el documento.',
    ])
  })
})
