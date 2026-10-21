import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

/** Tope de un archivo subido. Un convenio escaneado en PDF ronda 1 a 3 MB. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Tipos aceptados y la extensión con la que se guardan. */
const ALLOWED: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
}

/**
 * Tipo real del archivo según sus primeros bytes, no según lo que dice el navegador: un `.exe` renombrado a `.pdf`
 * llega con `application/pdf` y no debe guardarse ni servirse como tal. `null` si no es ninguno de los aceptados.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return null
}

/** Clave nueva para guardar un archivo: un UUID y la extensión de su tipo. Nunca sale del nombre que mandó el cliente. */
export function newStorageKey(mimeType: string): string {
  const extension = ALLOWED[mimeType]
  if (!extension) throw new Error(`tipo no aceptado: ${mimeType}`)
  return `${randomUUID()}${extension}`
}

// Solo las claves que genera `newStorageKey`. Las de antes de DOC-1 las escribía el cliente (podían ser
// «../../.env»), así que no se resuelven a una ruta.
const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/

export function isServerStorageKey(storageKey: string): boolean {
  return STORAGE_KEY.test(storageKey)
}

/** Carpeta de los archivos: `UPLOAD_DIR` o `./uploads`, relativa a donde corre el servidor. */
export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? 'uploads')
}

/** Ruta absoluta de una clave válida; lanza si la clave no la generó el servidor. */
export function storagePath(storageKey: string): string {
  if (!isServerStorageKey(storageKey)) throw new Error('clave de almacenamiento no válida')
  return resolve(uploadDir(), storageKey)
}

/**
 * multer entrega el nombre del archivo leído como latin1, pero los navegadores lo mandan en UTF-8: «médico» llega
 * como «mÃ©dico». Se recupera el UTF-8; si los bytes no lo son (un nombre de verdad en latin1), se deja como vino.
 */
export function decodeMultipartFilename(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8')
  return utf8.includes('\uFFFD') ? name : utf8
}

/**
 * Nombre que se guarda y se muestra: sin carpetas, sin caracteres de control y con un largo razonable. Si no queda
 * nada, «documento» más la extensión del tipo.
 */
export function cleanFilename(original: string, mimeType: string): string {
  const base = original.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
  return cleaned || `documento${ALLOWED[mimeType] ?? ''}`
}

/** Cabecera para abrir el archivo en el navegador con su nombre, también si lleva tildes. */
export function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
