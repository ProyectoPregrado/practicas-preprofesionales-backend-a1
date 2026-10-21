import { describe, expect, it } from 'vitest'
import { cleanFilename, decodeMultipartFilename, inlineDisposition, isServerStorageKey, newStorageKey, sniffMimeType, storagePath } from './document-file'

describe('DOC-1: sniffMimeType decide el tipo por el contenido', () => {
  it('reconoce PDF, PNG y JPG por sus primeros bytes', () => {
    expect(sniffMimeType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf')
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png')
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg')
  })

  it('rechaza un ejecutable, un HTML o un archivo demasiado corto aunque se llamen .pdf', () => {
    expect(sniffMimeType(Buffer.from('MZ\x90\x00 ejecutable'))).toBeNull()
    expect(sniffMimeType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull()
    expect(sniffMimeType(Buffer.from('%PD'))).toBeNull()
  })
})

describe('DOC-1: claves de almacenamiento', () => {
  it('genera claves con UUID y la extensión del tipo, que luego reconoce como propias', () => {
    const key = newStorageKey('application/pdf')
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(isServerStorageKey(key)).toBe(true)
    expect(newStorageKey('image/jpeg').endsWith('.jpg')).toBe(true)
  })

  it('no acepta tipos fuera de la lista', () => {
    expect(() => newStorageKey('text/html')).toThrow()
  })

  it('no resuelve claves escritas por el cliente antes de DOC-1, incluidas las que intentan salir de la carpeta', () => {
    for (const key of ['../../.env', 'convenio.pdf', '/etc/passwd', 'abc', `${'a'.repeat(36)}.pdf`]) {
      expect(isServerStorageKey(key)).toBe(false)
      expect(() => storagePath(key)).toThrow()
    }
  })
})

describe('DOC-1: nombre del archivo', () => {
  it('quita carpetas y caracteres de control y conserva las tildes', () => {
    expect(cleanFilename('C:\\Users\\ana\\Convenio firmado.pdf', 'application/pdf')).toBe('Convenio firmado.pdf')
    expect(cleanFilename('../../seguro\u0000médico.pdf', 'application/pdf')).toBe('seguromédico.pdf')
  })

  it('recupera el UTF-8 del nombre que multer leyó como latin1, y deja igual lo que no es UTF-8', () => {
    expect(decodeMultipartFilename(Buffer.from('Seguro médico.pdf', 'utf8').toString('latin1'))).toBe('Seguro médico.pdf')
    expect(decodeMultipartFilename('informe.pdf')).toBe('informe.pdf')
    expect(decodeMultipartFilename('café.pdf')).toBe('café.pdf')
  })

  it('pone un nombre por defecto si no queda nada', () => {
    expect(cleanFilename('   ', 'image/png')).toBe('documento.png')
  })

  it('la cabecera lleva un nombre ASCII y el nombre real codificado', () => {
    expect(inlineDisposition('Acta "final" ñandú.pdf')).toBe(
      `inline; filename="Acta _final_ _and_.pdf"; filename*=UTF-8''Acta%20%22final%22%20%C3%B1and%C3%BA.pdf`,
    )
  })
})
