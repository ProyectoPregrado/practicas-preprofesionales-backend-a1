import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiClient, GEMINI_DEFAULT_MODEL, chooseProvider, geminiModels } from './ai-client'

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }))

vi.mock('@google/genai', () => {
  class ApiError extends Error {
    constructor(public status: number) {
      super(`gemini ${status}`)
    }
  }
  return {
    ApiError,
    GoogleGenAI: class {
      models = { generateContent }
    },
  }
})


describe('IA-2: elegir proveedor', () => {
  it('sin claves no hay IA', () => {
    expect(chooseProvider({})).toBeNull()
  })

  it('sin AI_PROVIDER usa el primero que tenga clave, Claude antes que Gemini', () => {
    expect(chooseProvider({ GEMINI_API_KEY: 'g' })).toBe('gemini')
    expect(chooseProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('claude')
  })

  it('AI_PROVIDER elige, pero solo si esa clave existe', () => {
    expect(chooseProvider({ AI_PROVIDER: 'Gemini', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('gemini')
    expect(chooseProvider({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' })).toBeNull()
    expect(chooseProvider({ AI_PROVIDER: 'claude', GEMINI_API_KEY: 'g' })).toBeNull()
  })
})

describe('IA-2: pedir JSON a Gemini', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    generateContent.mockReset()
    process.env = { ...saved, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave-de-prueba' }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_MODEL
  })

  afterEach(() => {
    process.env = saved
  })

  it('manda el sistema, el texto y el PDF con el esquema JSON, y devuelve el JSON leído', async () => {
    generateContent.mockResolvedValue({ text: '{"ok":true}' })
    const client = new AiClient()

    const result = await client.json<{ ok: boolean }>({
      system: 'Eres un asistente.',
      schema: { type: 'object' },
      content: [
        { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=' },
        { type: 'text', text: 'Extrae los datos.' },
      ],
    })

    expect(result).toEqual({ ok: true })
    expect(client.enabled).toBe(true)
    expect(client.providerName).toBe('gemini')
    const request = generateContent.mock.calls[0][0]
    expect(request.model).toBe(GEMINI_DEFAULT_MODEL)
    expect(request.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } },
      { text: 'Extrae los datos.' },
    ])
    expect(request.config).toMatchObject({
      systemInstruction: 'Eres un asistente.',
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
    })
  })

  it('GEMINI_MODEL admite una lista en orden de preferencia', () => {
    expect(geminiModels({ GEMINI_MODEL: ' gemini-a , gemini-b ,' })).toEqual(['gemini-a', 'gemini-b'])
    expect(geminiModels({})).toEqual([GEMINI_DEFAULT_MODEL])
  })

  it('si un modelo está saturado (503) o sin cuota (429), prueba el siguiente de la lista', async () => {
    process.env.GEMINI_MODEL = 'saturado,sin-cuota,bueno'
    const { ApiError } = await import('@google/genai')
    generateContent
      .mockRejectedValueOnce(new (ApiError as unknown as new (status: number) => Error)(503))
      .mockRejectedValueOnce(new (ApiError as unknown as new (status: number) => Error)(429))
      .mockResolvedValueOnce({ text: '{"ok":true}' })

    const result = await new AiClient().json({ system: 's', schema: {}, content: [{ type: 'text', text: 't' }] })

    expect(result).toEqual({ ok: true })
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual(['saturado', 'sin-cuota', 'bueno'])
  })

  it('un error que no es de saturación no prueba otros modelos', async () => {
    process.env.GEMINI_MODEL = 'a,b'
    generateContent.mockRejectedValueOnce(new Error('esquema inválido'))
    await expect(new AiClient().json({ system: 's', schema: {}, content: [{ type: 'text', text: 't' }] })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('GEMINI_MODEL cambia el modelo', async () => {
    process.env.GEMINI_MODEL = 'otro-modelo'
    generateContent.mockResolvedValue({ text: '{}' })
    await new AiClient().json({ system: 's', schema: {}, content: [{ type: 'text', text: 't' }] })
    expect(generateContent.mock.calls[0][0].model).toBe('otro-modelo')
  })

  it('un fallo de Gemini, una respuesta vacía o un JSON roto llegan como 503 para caer al modo básico', async () => {
    const client = new AiClient()
    const request = { system: 's', schema: {}, content: [{ type: 'text' as const, text: 't' }] }
    for (const outcome of [Promise.reject(new Error('429 cuota')), Promise.resolve({ text: undefined }), Promise.resolve({ text: '{roto' })]) {
      generateContent.mockReturnValueOnce(outcome)
      await expect(client.json(request)).rejects.toBeInstanceOf(ServiceUnavailableException)
    }
  })

  it('sin clave queda desactivado y no llama a nadie', async () => {
    delete process.env.GEMINI_API_KEY
    const client = new AiClient()
    expect(client.enabled).toBe(false)
    await expect(client.json({ system: 's', schema: {}, content: [] })).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(generateContent).not.toHaveBeenCalled()
  })
})
