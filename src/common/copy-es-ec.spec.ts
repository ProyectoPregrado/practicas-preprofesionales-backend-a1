import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// UX-3: los mensajes que ve una persona están en tuteo (Ecuador). Este test lee el código del backend y falla
// si un texto usa voseo («iniciá», «generá», «acá»). Si falla, cámbialo a tuteo («inicia», «genera», «aquí»).
// Si una palabra legítima coincide por error, quítala de la lista y explica por qué en el PR.

const VOSEO = [
  'vos', 'sos', 'tenés', 'podés', 'querés', 'sabés', 'entrás', 'cerrás', 'hacés', 'ponés', 'venís', 'decís',
  'abrí', 'accedé', 'agregá', 'andá', 'buscá', 'cargá', 'cerrá', 'completá', 'confirmá', 'dejá', 'describí',
  'descargá', 'elegí', 'enviá', 'entrá', 'escribí', 'esperá', 'filtrá', 'generá', 'guardá', 'hacé', 'indicá',
  'ingresá', 'iniciá', 'mirá', 'ordená', 'ponete', 'postulá', 'probá', 'publicá', 'recibí', 'registrá', 'revisá',
  'seleccioná', 'subí', 'vení', 'volvé',
  'acá',
]

const SRC = resolve(__dirname, '..')

// Los comentarios del código no son mensajes. Se conservan los saltos de línea para que los números de línea
// del reporte sean exactos. (Recorrido simple, sin regex: evita el backtracking.)
function withoutComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2)
      const stop = close === -1 ? source.length : close + 2
      out += '\n'.repeat(source.slice(i, stop).split('\n').length - 1)
      i = stop
    } else if (source.startsWith('//', i) && source[i - 1] !== ':') {
      const eol = source.indexOf('\n', i)
      i = eol === -1 ? source.length : eol
    } else {
      out += source[i]
      i += 1
    }
  }
  return out
}

// Los límites de palabra de JS no entienden las tildes: se usan letras Unicode.
const voseoRegex = new RegExp(`(?<![\\p{L}])(${VOSEO.join('|')})(?![\\p{L}])`, 'giu')

const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'))
  .map((path) => ({ path: path.replaceAll('\\', '/'), source: readFileSync(join(SRC, path), 'utf8') }))

describe('mensajes del backend en tuteo (UX-3)', () => {
  it('encuentra los archivos del código', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('no contiene voseo', () => {
    const found = files.flatMap(({ path, source }) =>
      withoutComments(source)
        .split('\n')
        .flatMap((line, index) => [...line.matchAll(voseoRegex)].map((m) => `src/${path}:${index + 1} «${m[0]}»`)),
    )

    expect(found).toEqual([])
  })

  it('la lista de palabras detecta voseo de verdad (guarda del propio test)', () => {
    expect('la sesión expiró, iniciá sesión de nuevo'.match(voseoRegex)).toEqual(['iniciá'])
    expect('Generá una con openssl'.match(voseoRegex)).toEqual(['Generá'])
  })

  it('no se confunde con palabras correctas que se parecen', () => {
    expect('inicia sesión de nuevo, genera una; además está aquí'.match(voseoRegex)).toBeNull()
  })
})
