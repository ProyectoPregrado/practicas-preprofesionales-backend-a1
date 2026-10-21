export interface AccreditationInput {
  placementId: number
  studentName: string
  requiredHours: number
  approvedHours: number
  pendingHours: number
  hasAgreement: boolean
  hasInsurance: boolean
  hasFinalReport: boolean
  tutorEvaluationScore: number | null
  companyEvaluationScore: number | null
  placementStatus: string
}

export type AccreditationLevel =
  | 'ACREDITADO'
  | 'ACREDITADO_CON_OBSERVACIONES'
  | 'PENDIENTE'
  | 'NO_ACREDITADO'

export interface AccreditationResult {
  placementId: number
  studentName: string
  level: AccreditationLevel
  reasons: string[]
  completionPercentage: number
}

const MIN_EVALUATION_SCORE = 3

interface Decision {
  level: AccreditationLevel
  reasons: string[]
}

interface Rule {
  // Qué situación detecta la regla; solo documenta, no se usa para decidir.
  when: string
  applies: (input: AccreditationInput) => boolean
  decide: (input: AccreditationInput) => Decision
}

// Una nota ausente o por debajo del mínimo no alcanza. Un `NaN` tampoco: la comparación da falso.
const meetsMinimum = (score: number | null): boolean => score !== null && score >= MIN_EVALUATION_SCORE

// Se niega «alcanzó» en vez de comparar con `<`: con `NaN` ambas comparaciones dan falso, y la regla
// original decía «horas insuficientes» en ese caso (el mismo motivo por el que `meetsMinimum` es positivo).
const hoursReached = (input: AccreditationInput): boolean => input.approvedHours >= input.requiredHours

// Aviso opcional de horas pendientes; cada regla elige cómo se llaman (sin revisar o de aprobación).
// E5-01b: «1 hora pendiente», no «1 horas pendientes».
const pendingNote = (input: AccreditationInput, label: 'sin revisar' | 'de aprobación'): string[] => {
  const hours = input.pendingHours
  // Forma positiva a propósito: con NaN la comparación da falso y no hay aviso, igual que antes.
  if (hours > 0) return [hours === 1 ? `hay 1 hora pendiente ${label}` : `hay ${hours} horas pendientes ${label}`]
  return []
}

// E5-01b: sin horas requeridas no hay nada que dividir; el requisito de horas está cumplido (100 %).
const completionPercentage = (input: AccreditationInput): number =>
  input.requiredHours > 0 ? Math.round((input.approvedHours / input.requiredHours) * 100) : 100

// E5-02 (antes D-05): la decisión es una lista de reglas ordenadas. La PRIMERA que aplica decide
// nivel y razones; el orden de la lista es la precedencia. Está fijado por los tests de E5-01.
const RULES: Rule[] = [
  {
    when: 'la plaza fue abandonada',
    applies: (input) => input.placementStatus === 'ABANDONED',
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['placement abandonado', ...pendingNote(input, 'sin revisar')],
    }),
  },
  {
    when: 'la plaza está suspendida',
    applies: (input) => input.placementStatus === 'SUSPENDED',
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['placement suspendido', ...(input.hasAgreement ? ['convenio vigente pese a la suspensión'] : [])],
    }),
  },
  {
    when: 'las horas aprobadas no alcanzan las requeridas',
    applies: (input) => !hoursReached(input),
    decide: (input) => ({
      level: 'PENDIENTE',
      reasons: ['horas insuficientes', ...pendingNote(input, 'de aprobación')],
    }),
  },
  {
    when: 'falta el convenio',
    applies: (input) => !input.hasAgreement,
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['falta convenio', ...(input.hasInsurance ? ['seguro vigente pese a la falta de convenio'] : [])],
    }),
  },
  {
    when: 'falta el seguro',
    applies: (input) => !input.hasInsurance,
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['falta seguro', ...pendingNote(input, 'de aprobación')],
    }),
  },
  {
    when: 'falta el informe final',
    applies: (input) => !input.hasFinalReport,
    decide: () => ({ level: 'PENDIENTE', reasons: ['falta informe final'] }),
  },
  {
    when: 'el tutor todavía no evalúa',
    applies: (input) => input.tutorEvaluationScore === null,
    decide: () => ({ level: 'PENDIENTE', reasons: ['falta evaluación del tutor'] }),
  },
  {
    // La regla anterior ya descartó la nota ausente, así que aquí la nota existe y es menor al mínimo.
    // El informe final está entregado: las reglas de arriba lo exigen.
    when: 'la evaluación del tutor está por debajo del mínimo',
    applies: (input) => !meetsMinimum(input.tutorEvaluationScore),
    decide: () => ({
      level: 'NO_ACREDITADO',
      reasons: ['evaluación del tutor por debajo del mínimo', 'informe final entregado pese a evaluación baja'],
    }),
  },
  {
    when: 'falta la evaluación de la empresa o es baja',
    applies: (input) => !meetsMinimum(input.companyEvaluationScore),
    decide: () => ({
      level: 'ACREDITADO_CON_OBSERVACIONES',
      reasons: ['falta evaluación de la empresa o es baja'],
    }),
  },
]

// Si ninguna regla de arriba aplica, la plaza cumple todas las condiciones.
const ACCREDITED: Decision = { level: 'ACREDITADO', reasons: [] }

export function calculateAccreditationStatus(input: AccreditationInput): AccreditationResult {
  const decision = RULES.find((rule) => rule.applies(input))?.decide(input) ?? ACCREDITED

  return {
    placementId: input.placementId,
    studentName: input.studentName,
    level: decision.level,
    reasons: decision.reasons,
    completionPercentage: completionPercentage(input),
  }
}
