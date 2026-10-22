import Anthropic from '@anthropic-ai/sdk'
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai'
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

/** Modelo de Claude. Esfuerzo bajo: son extracciones cortas y la persona está esperando la respuesta. */
export const CLAUDE_MODEL = 'claude-opus-5-5'
/** Alias que sigue al modelo Flash vigente de Gemini (el del plan gratuito); se cambia con `GEMINI_MODEL`. */
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'

/** Respuestas de Gemini que justifican probar con el siguiente modelo de la lista: saturado, sin cuota o retirado. */
const GEMINI_RETRY_STATUS = new Set([404, 429, 500, 503])

/** `GEMINI_MODEL` admite varios modelos separados por comas, en orden de preferencia. */
export function geminiModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const models = (env.GEMINI_MODEL ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  return models.length > 0 ? models : [GEMINI_DEFAULT_MODEL]
}

/** Un trozo de la petición, igual para cualquier proveedor: texto, o un archivo (PDF o imagen) en base64. */
export type AiPart = { type: 'text'; text: string } | { type: 'file'; mimeType: string; data: string }

export interface JsonRequest {
  system: string
  content: AiPart[]
  /** Esquema JSON de la respuesta; ambos proveedores lo hacen cumplir. */
  schema: Record<string, unknown>
  maxTokens?: number
}

export type AiProviderName = 'claude' | 'gemini'

interface Provider {
  name: AiProviderName
  json(request: JsonRequest): Promise<string>
}

class ClaudeProvider implements Provider {
  readonly name = 'claude' as const
  private readonly client = new Anthropic()

  async json({ system, content, schema, maxTokens = 4000 }: JsonRequest): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      // Si Claude declina por seguridad, el servidor reintenta con el modelo de respaldo recomendado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: content.map(toClaudeBlock) }],
    })
    if (response.stop_reason === 'refusal') throw new Error('la IA no pudo procesar esta solicitud')
    const text = response.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') throw new Error('la IA no devolvió una respuesta')
    return text.text
  }
}

function toClaudeBlock(part: AiPart): Anthropic.Beta.Messages.BetaContentBlockParam {
  if (part.type === 'text') return { type: 'text', text: part.text }
  if (part.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: part.mimeType as 'image/png' | 'image/jpeg', data: part.data } }
}

class GeminiProvider implements Provider {
  readonly name = 'gemini' as const
  private readonly client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  private readonly models = geminiModels()

  /**
   * Prueba los modelos en orden: si uno está saturado (503), sin cuota (429) o ya no existe (404), pasa al siguiente.
   * En el plan gratuito la saturación es frecuente y no debería tumbar la función.
   */
  async json(request: JsonRequest): Promise<string> {
    let lastError: unknown
    for (const model of this.models) {
      try {
        return await this.ask(model, request)
      } catch (error) {
        lastError = error
        if (!(error instanceof GeminiApiError && GEMINI_RETRY_STATUS.has(error.status))) throw error
      }
    }
    throw lastError
  }

  private async ask(model: string, { system, content, schema, maxTokens = 4000 }: JsonRequest): Promise<string> {
    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: content.map((part) =>
            part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mimeType, data: part.data } },
          ),
        },
      ],
      config: {
        systemInstruction: system,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    })
    const text = response.text
    if (!text) throw new Error('la IA no devolvió una respuesta')
    return text
  }
}

/**
 * Elige el proveedor: `AI_PROVIDER` si está (claude o gemini); si no, el primero que tenga clave. Sin ninguna clave
 * queda desactivado y cada función usa su modo básico.
 */
export function chooseProvider(env: NodeJS.ProcessEnv = process.env): AiProviderName | null {
  const wanted = env.AI_PROVIDER?.trim().toLowerCase()
  const hasClaude = Boolean(env.ANTHROPIC_API_KEY)
  const hasGemini = Boolean(env.GEMINI_API_KEY)
  if (wanted === 'claude') return hasClaude ? 'claude' : null
  if (wanted === 'gemini') return hasGemini ? 'gemini' : null
  if (hasClaude) return 'claude'
  return hasGemini ? 'gemini' : null
}

function createProvider(name: AiProviderName | null): Provider | null {
  if (name === 'claude') return new ClaudeProvider()
  if (name === 'gemini') return new GeminiProvider()
  return null
}

/**
 * IA-1/IA-2: acceso a la IA del asistente, con Claude o con Gemini según el `.env`. Una sola forma de pedir JSON con
 * esquema; si la IA falla o declina, lanza 503 para que quien llama caiga a su modo básico.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name)
  private readonly provider: Provider | null

  constructor() {
    this.provider = createProvider(chooseProvider())
    this.logger.log(this.provider ? `IA activada con ${this.provider.name}` : 'IA desactivada: no hay clave configurada')
  }

  get enabled(): boolean {
    return this.provider !== null
  }

  get providerName(): AiProviderName | null {
    return this.provider?.name ?? null
  }

  async json<T>(request: JsonRequest): Promise<T> {
    if (!this.provider) throw new ServiceUnavailableException('la IA no está configurada')
    try {
      return JSON.parse(await this.provider.json(request)) as T
    } catch (error) {
      const status = error instanceof Anthropic.APIError || error instanceof GeminiApiError ? ` (${error.status})` : ''
      this.logger.warn(`fallo de ${this.provider.name}${status}: ${error instanceof Error ? error.message : String(error)}`)
      throw new ServiceUnavailableException('la IA no está disponible en este momento')
    }
  }
}
