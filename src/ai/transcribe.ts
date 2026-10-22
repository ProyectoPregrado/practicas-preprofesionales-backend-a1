/** Tope de un audio de dictado: unos 2 minutos en WAV mono de 16 kHz. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024

/** Formatos que graba el navegador o que se envían convertidos a WAV. */
export const AUDIO_TYPES = ['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4']

export const TRANSCRIBE_SYSTEM = [
  'Transcribes audios cortos en español de Ecuador en los que un estudiante de prácticas cuenta qué hizo en su día.',
  'Escribe exactamente lo que dice, con puntuación y tildes correctas, sin resumir ni agregar nada.',
  'Si no se entiende nada o el audio está en silencio, devuelve el texto vacío.',
].join('\n')

export const TRANSCRIBE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const

/** El tipo sin parámetros (`audio/webm;codecs=opus` → `audio/webm`), y `audio/x-wav` como `audio/wav`. */
export function normalizeAudioType(mimeType: string): string | null {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  if (!AUDIO_TYPES.includes(base)) return null
  return base === 'audio/x-wav' ? 'audio/wav' : base
}
