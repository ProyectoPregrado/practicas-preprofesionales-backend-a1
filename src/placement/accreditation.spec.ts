import { describe, expect, it } from 'vitest'
import { AccreditationInput, calculateAccreditationStatus } from './accreditation'

const base: AccreditationInput = {
  placementId: 1,
  studentName: 'Estudiante 0',
  requiredHours: 240,
  approvedHours: 240,
  pendingHours: 0,
  hasAgreement: true,
  hasInsurance: true,
  hasFinalReport: true,
  tutorEvaluationScore: 4.5,
  companyEvaluationScore: 4.2,
  placementStatus: 'COMPLETED',
}

const run = (overrides: Partial<AccreditationInput> = {}) =>
  calculateAccreditationStatus({ ...base, ...overrides })

// E5-01: tests de caracterización. Describen lo que el código hace hoy, no lo que debería hacer.
describe('calculateAccreditationStatus', () => {
  it('accredits a placement with all hours, documents and evaluations', () => {
    const result = run()

    expect(result.level).toBe('ACREDITADO')
    expect(result.reasons).toHaveLength(0)
    expect(result.completionPercentage).toBe(100)
  })

  it('marks as PENDIENTE when hours are still missing', () => {
    const result = run({ approvedHours: 120, pendingHours: 40, placementStatus: 'ACTIVE' })

    expect(result.level).toBe('PENDIENTE')
    expect(result.reasons).toContain('horas insuficientes')
    expect(result.completionPercentage).toBe(50)
  })

  it('echoes placementId and studentName', () => {
    const result = run({ placementId: 7, studentName: 'Ana' })

    expect(result).toMatchObject({ placementId: 7, studentName: 'Ana' })
  })

  // Cada fila es una rama de decisión: entrada → nivel y razones, en orden.
  const rules: Array<[string, Partial<AccreditationInput>, string, string[]]> = [
    ['abandoned', { placementStatus: 'ABANDONED' }, 'NO_ACREDITADO', ['placement abandonado']],
    [
      'abandoned with pending hours',
      { placementStatus: 'ABANDONED', pendingHours: 8 },
      'NO_ACREDITADO',
      ['placement abandonado', 'hay 8 horas pendientes sin revisar'],
    ],
    ['suspended', { placementStatus: 'SUSPENDED', hasAgreement: false }, 'NO_ACREDITADO', ['placement suspendido']],
    [
      'suspended with agreement',
      { placementStatus: 'SUSPENDED' },
      'NO_ACREDITADO',
      ['placement suspendido', 'convenio vigente pese a la suspensión'],
    ],
    ['hours short', { approvedHours: 239, placementStatus: 'ACTIVE' }, 'PENDIENTE', ['horas insuficientes']],
    [
      'hours short with pending hours',
      { approvedHours: 100, pendingHours: 12 },
      'PENDIENTE',
      ['horas insuficientes', 'hay 12 horas pendientes de aprobación'],
    ],
    ['no agreement', { hasAgreement: false, hasInsurance: false }, 'NO_ACREDITADO', ['falta convenio']],
    [
      'no agreement but insurance',
      { hasAgreement: false },
      'NO_ACREDITADO',
      ['falta convenio', 'seguro vigente pese a la falta de convenio'],
    ],
    ['no insurance', { hasInsurance: false }, 'NO_ACREDITADO', ['falta seguro']],
    [
      'no insurance with pending hours',
      { hasInsurance: false, pendingHours: 5 },
      'NO_ACREDITADO',
      ['falta seguro', 'hay 5 horas pendientes de aprobación'],
    ],
    ['no final report', { hasFinalReport: false }, 'PENDIENTE', ['falta informe final']],
    ['no tutor evaluation', { tutorEvaluationScore: null }, 'PENDIENTE', ['falta evaluación del tutor']],
    [
      'tutor score below minimum',
      { tutorEvaluationScore: 2.9 },
      'NO_ACREDITADO',
      ['evaluación del tutor por debajo del mínimo', 'informe final entregado pese a evaluación baja'],
    ],
    [
      'no company evaluation',
      { companyEvaluationScore: null },
      'ACREDITADO_CON_OBSERVACIONES',
      ['falta evaluación de la empresa o es baja'],
    ],
    [
      'company score below minimum',
      { companyEvaluationScore: 2.9 },
      'ACREDITADO_CON_OBSERVACIONES',
      ['falta evaluación de la empresa o es baja'],
    ],
  ]

  it.each(rules)('%s', (_name, overrides, level, reasons) => {
    const result = run(overrides)

    expect(result.level).toBe(level)
    expect(result.reasons).toEqual(reasons)
  })

  describe('boundaries', () => {
    it('accepts a tutor score of exactly 3', () => {
      expect(run({ tutorEvaluationScore: 3 }).level).toBe('ACREDITADO')
    })

    it('accepts a company score of exactly 3', () => {
      expect(run({ companyEvaluationScore: 3 }).level).toBe('ACREDITADO')
    })

    it('treats a tutor score of 0 as an evaluation, not as a missing one', () => {
      const result = run({ tutorEvaluationScore: 0 })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons[0]).toBe('evaluación del tutor por debajo del mínimo')
    })

    it('accepts approved hours equal to the required hours', () => {
      expect(run({ approvedHours: 240, requiredHours: 240 }).level).toBe('ACREDITADO')
    })

    it('does not cap the percentage above 100', () => {
      const result = run({ approvedHours: 300 })

      expect(result.level).toBe('ACREDITADO')
      expect(result.completionPercentage).toBe(125)
    })

    it('rounds the percentage to the nearest integer', () => {
      expect(run({ approvedHours: 1, requiredHours: 3 }).completionPercentage).toBe(33)
      expect(run({ approvedHours: 2, requiredHours: 3 }).completionPercentage).toBe(67)
    })

    it('ignores pending hours when everything else is in order', () => {
      expect(run({ pendingHours: 40 }).level).toBe('ACREDITADO')
    })

    it.each([
      [{ placementStatus: 'ABANDONED' }, 'hay 1 hora pendiente sin revisar'],
      [{ approvedHours: 0 }, 'hay 1 hora pendiente de aprobación'],
      [{ hasInsurance: false }, 'hay 1 hora pendiente de aprobación'],
    ])('uses the singular for a single pending hour (%o)', (overrides, reason) => {
      expect(run({ ...overrides, pendingHours: 1 }).reasons).toContain(reason)
    })

    it.each([
      [{ placementStatus: 'ABANDONED' }, 'hay 2 horas pendientes sin revisar'],
      [{ approvedHours: 0 }, 'hay 2 horas pendientes de aprobación'],
    ])('keeps the plural for more than one pending hour (%o)', (overrides, reason) => {
      expect(run({ ...overrides, pendingHours: 2 }).reasons).toContain(reason)
    })

    it('does not mention pending hours when there are none', () => {
      expect(run({ approvedHours: 10, pendingHours: 0 }).reasons).toEqual(['horas insuficientes'])
    })
  })

  describe('precedence', () => {
    it('ABANDONED wins over missing documents and evaluations', () => {
      const result = run({
        placementStatus: 'ABANDONED',
        hasAgreement: false,
        hasInsurance: false,
        tutorEvaluationScore: null,
      })

      expect(result.reasons).toEqual(['placement abandonado'])
    })

    it('SUSPENDED wins over insufficient hours', () => {
      const result = run({ placementStatus: 'SUSPENDED', approvedHours: 0, hasAgreement: false })

      expect(result.reasons).toEqual(['placement suspendido'])
    })

    it('checks hours before documents', () => {
      const result = run({ approvedHours: 0, hasAgreement: false })

      expect(result.reasons).toEqual(['horas insuficientes'])
    })

    it('checks agreement before insurance, insurance before report, report before evaluations', () => {
      expect(run({ hasAgreement: false, hasInsurance: false, hasFinalReport: false }).reasons).toEqual(['falta convenio'])
      expect(run({ hasInsurance: false, hasFinalReport: false }).reasons).toEqual(['falta seguro'])
      expect(run({ hasFinalReport: false, tutorEvaluationScore: null }).reasons).toEqual(['falta informe final'])
    })

    it('checks the tutor evaluation before the company evaluation', () => {
      expect(run({ tutorEvaluationScore: null, companyEvaluationScore: null }).reasons).toEqual([
        'falta evaluación del tutor',
      ])
    })

    it.each(['ACTIVE', 'PENDING_DOCS', 'COMPLETED', 'ANYTHING'])(
      'does not treat the %s status specially',
      (placementStatus) => {
        expect(run({ placementStatus }).level).toBe('ACREDITADO')
      },
    )
  })

  // E5-01b: con 0 horas requeridas la división daba NaN o Infinity, que la API serializa como null y la
  // pantalla de acreditación mostraba como «null%». Sin horas que exigir, el requisito de horas está cumplido: 100 %.
  // El nivel no cambia: si una plaza puede exigir 0 horas es una decisión de producto, no de este arreglo.
  describe('requiredHours of zero', () => {
    it('reports 100 % (a finite number) with no approved hours', () => {
      const result = run({ requiredHours: 0, approvedHours: 0 })

      expect(result.level).toBe('ACREDITADO')
      expect(result.completionPercentage).toBe(100)
    })

    it('reports 100 % (a finite number) with approved hours', () => {
      expect(run({ requiredHours: 0, approvedHours: 10 }).completionPercentage).toBe(100)
    })

    it('survives JSON serialization without turning into null', () => {
      const json = JSON.parse(JSON.stringify(run({ requiredHours: 0, approvedHours: 5 })))

      expect(json.completionPercentage).toBe(100)
    })
  })
})
