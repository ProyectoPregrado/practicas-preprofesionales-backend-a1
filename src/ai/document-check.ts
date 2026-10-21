import type { HintLevel } from './review-hints'

/** Lo que la IA lee de un convenio o un seguro. Vacío lo que no aparece en el documento. */
export interface ExtractedDocument {
  documentType: 'AGREEMENT' | 'INSURANCE' | 'REPORT' | 'OTHER'
  personName: string
  companyName: string
  /** `AAAA-MM-DD`. */
  validFrom: string
  validTo: string
  policyNumber: string
  summary: string
}

export interface DocumentFinding {
  level: HintLevel
  message: string
}

export interface PlacementFacts {
  studentName: string
  companyName: string
  /** `AAAA-MM-DD`. */
  startDate: string
  endDate: string
  declaredKind: string
}

export const CHECK_SYSTEM = [
  'Lees documentos de prácticas preprofesionales en Ecuador: convenios con la empresa, pólizas de seguro e informes.',
  'Extrae solo lo que está escrito en el documento; deja vacío lo que no aparezca. No inventes.',
  '- documentType: AGREEMENT (convenio), INSURANCE (seguro o póliza), REPORT (informe) u OTHER.',
  '- personName: el nombre del estudiante o asegurado. companyName: la empresa o institución receptora.',
  '- validFrom y validTo: la vigencia en formato AAAA-MM-DD.',
  '- policyNumber: el número de póliza o de convenio.',
  '- summary: una frase en español que diga qué es el documento.',
].join('\n')

export const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string', enum: ['AGREEMENT', 'INSURANCE', 'REPORT', 'OTHER'] },
    personName: { type: 'string' },
    companyName: { type: 'string' },
    validFrom: { type: 'string' },
    validTo: { type: 'string' },
    policyNumber: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['documentType', 'personName', 'companyName', 'validFrom', 'validTo', 'policyNumber', 'summary'],
  additionalProperties: false,
} as const

const KIND_LABEL: Record<string, string> = { AGREEMENT: 'convenio', INSURANCE: 'seguro', REPORT: 'informe', EVIDENCE: 'evidencia' }

const words = (text: string): string[] =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)

/** Dos nombres coinciden si comparten al menos dos palabras (o una, si uno de ellos tiene una sola). */
export function namesMatch(a: string, b: string): boolean {
  const left = new Set(words(a))
  const right = words(b)
  const shared = right.filter((word) => left.has(word)).length
  return shared >= Math.min(2, left.size, right.length) && shared > 0
}

const SEVERITY: Record<HintLevel, number> = { red: 0, yellow: 1, green: 2 }

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

type Rule = (doc: ExtractedDocument, facts: PlacementFacts) => DocumentFinding | null

const RULES: Rule[] = [
  (doc, facts) => {
    const declared = KIND_LABEL[facts.declaredKind]
    const read = KIND_LABEL[doc.documentType]
    if (!declared || !read || read === declared) return null
    return { level: 'red', message: `Se subió como ${declared}, pero el documento parece un ${read}.` }
  },
  (doc, facts) =>
    isDay(doc.validTo) && doc.validTo < facts.endDate
      ? { level: 'red', message: `Vence el ${doc.validTo}, antes de que termine la práctica (${facts.endDate}).` }
      : null,
  (doc, facts) =>
    isDay(doc.validFrom) && doc.validFrom > facts.startDate
      ? { level: 'yellow', message: `Empieza a regir el ${doc.validFrom}, después del inicio de la práctica (${facts.startDate}).` }
      : null,
  (doc, facts) =>
    doc.personName && !namesMatch(doc.personName, facts.studentName)
      ? { level: 'yellow', message: `Está a nombre de «${doc.personName}», no de ${facts.studentName}.` }
      : null,
  (doc, facts) =>
    doc.companyName && !namesMatch(doc.companyName, facts.companyName)
      ? { level: 'yellow', message: `Menciona a «${doc.companyName}», no a ${facts.companyName}.` }
      : null,
  (doc, facts) =>
    (facts.declaredKind === 'AGREEMENT' || facts.declaredKind === 'INSURANCE') && !isDay(doc.validTo)
      ? { level: 'yellow', message: 'No se encontró la fecha de vencimiento en el documento.' }
      : null,
]

/**
 * Compara lo leído con la plaza y devuelve hallazgos, los más graves primero. Las fechas `AAAA-MM-DD` se comparan
 * como texto, que ordena igual que el calendario.
 */
export function checkAgainstPlacement(doc: ExtractedDocument, facts: PlacementFacts): DocumentFinding[] {
  const findings = RULES.map((rule) => rule(doc, facts)).filter((finding): finding is DocumentFinding => finding !== null)
  if (findings.length === 0) return [{ level: 'green', message: 'Coincide con la práctica: nombre, empresa y vigencia.' }]
  return findings.sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level])
}
