import { afterEach, beforeEach } from 'vitest'

// E6-02: el CI corre en UTC, donde los desfases de zona horaria no se ven. Estos tests fuerzan la
// zona del proceso: UTC, una negativa (Ecuador, UTC-5) y una positiva (Nueva Zelanda, UTC+12/+13).
export const TIME_ZONES = ['UTC', 'America/Guayaquil', 'Pacific/Auckland'] as const

// Cambia `process.env.TZ` antes de cada test y lo restaura después.
export function useTimeZone(zone: string): void {
  let original: string | undefined
  beforeEach(() => {
    original = process.env.TZ
    process.env.TZ = zone
  })
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })
}
