import Anthropic from '@anthropic-ai/sdk'
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

/** Modelo de las funciones de IA. Esfuerzo bajo: son extracciones cortas y la persona está esperando la respuesta. */
export const AI_MODEL = 'claude-opus-5-5'

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam

interface JsonRequest {
  system: string
  content: ContentBlock[]
  /** Esquema JSON de la respuesta; la API garantiza que la salida lo cumple. */
  schema: Record<string, unknown>
  maxTokens?: number
}

/**
 * IA-1: acceso a Claude para las funciones del asistente. Sin `ANTHROPIC_API_KEY` queda desactivado y cada función
 * usa su modo básico sin IA, para que la app (y una demo) no dependa de tener la clave.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name)
  private readonly client: Anthropic | null

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null
  }

  get enabled(): boolean {
    return this.client !== null
  }

  /**
   * Una petición con salida JSON estructurada. Si Claude declina por seguridad, el servidor reintenta con el modelo
   * de respaldo recomendado (`fallbacks: "default"`); si aun así no hay respuesta, o la API falla, lanza 503 para que
   * quien llama pueda caer al modo básico.
   */
  async json<T>({ system, content, schema, maxTokens = 4000 }: JsonRequest): Promise<T> {
    if (!this.client) throw new ServiceUnavailableException('la IA no está configurada')
    try {
      const response = await this.client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content }],
      })
      if (response.stop_reason === 'refusal') {
        throw new ServiceUnavailableException('la IA no pudo procesar esta solicitud')
      }
      const text = response.content.find((block) => block.type === 'text')
      if (!text || text.type !== 'text') throw new ServiceUnavailableException('la IA no devolvió una respuesta')
      return JSON.parse(text.text) as T
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error
      if (error instanceof Anthropic.APIError) {
        this.logger.warn(`Claude respondió ${error.status}: ${error.message}`)
      } else {
        this.logger.warn(`fallo al llamar a Claude: ${String(error)}`)
      }
      throw new ServiceUnavailableException('la IA no está disponible en este momento')
    }
  }
}
