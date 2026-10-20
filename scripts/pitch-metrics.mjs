import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// Consume resultados reales; no cuenta declaraciones `it()` ni presupone que todos pasan.
const [backendPath, frontendPath, lintPath, outputPath] = process.argv.slice(2)
if (!backendPath || !frontendPath || !lintPath) {
  throw new Error('Uso: node scripts/pitch-metrics.mjs backend.json frontend.json eslint.json [salida.json]')
}
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendRoot = resolve(backendRoot, '../practicas-preprofesionales-frontend-a1')
const gitBinary = process.env.GIT_EXECUTABLE
if (!gitBinary || !isAbsolute(gitBinary)) throw new Error('Define GIT_EXECUTABLE con la ruta absoluta de Git')
const git = (cwd, args) => execFileSync(gitBinary, args, { cwd, encoding: 'utf8' }).trim()

function sourceEvidence(root) {
  const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter((file) => file && (file.startsWith('src/') || /^(package.json|pnpm-lock.yaml|.*config\.[cm]?[jt]s)$/.test(file)))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  return { commit: git(root, ['rev-parse', 'HEAD']), sourceSha256: hash.digest('hex'), sourceFiles: files.length }
}

function testEvidence(path) {
  const raw = readFileSync(path)
  const report = JSON.parse(raw)
  if (!Array.isArray(report.testResults) || typeof report.numTotalTests !== 'number') {
    throw new Error(`No es un reporte JSON de Vitest: ${path}`)
  }
  return {
    reportSha256: createHash('sha256').update(raw).digest('hex'),
    startedAt: new Date(report.startTime).toISOString(),
    success: report.success,
    files: report.testResults.length,
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    pending: report.numPendingTests,
    todo: report.numTodoTests,
  }
}

const lintRaw = readFileSync(lintPath)
const lint = JSON.parse(lintRaw)
if (!Array.isArray(lint)) throw new Error('El reporte de ESLint debe ser un arreglo')
const result = {
  measuredAt: new Date().toISOString(),
  note: 'Los resultados corresponden a los comandos y alcances documentados en pitch-demo-anthony.md. Los hashes de fuentes identifican el árbol medido, incluidos cambios sin commit.',
  backend: { ...sourceEvidence(backendRoot), tests: testEvidence(backendPath) },
  frontend: { ...sourceEvidence(frontendRoot), tests: testEvidence(frontendPath) },
  backendLint: {
    reportSha256: createHash('sha256').update(lintRaw).digest('hex'),
    errors: lint.reduce((sum, file) => sum + file.errorCount, 0),
    warnings: lint.reduce((sum, file) => sum + file.warningCount, 0),
    findings: lint.flatMap((file) => file.messages.map((message) => ({
      file: file.filePath.replaceAll('\\', '/').split('backend-a1/').at(-1),
      line: message.line, severity: message.severity, rule: message.ruleId, message: message.message,
    }))),
  },
}
const json = JSON.stringify(result, null, 2) + '\n'
if (outputPath) writeFileSync(outputPath, json)
process.stdout.write(json)
