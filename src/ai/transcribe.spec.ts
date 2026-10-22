import { describe, expect, it } from 'vitest'
import { normalizeAudioType } from './transcribe'

describe('IA-3: tipos de audio del dictado', () => {
  it('acepta WAV, webm, ogg, mp3 y mp4, sin parámetros y con audio/x-wav como audio/wav', () => {
    expect(normalizeAudioType('audio/wav')).toBe('audio/wav')
    expect(normalizeAudioType('audio/x-wav')).toBe('audio/wav')
    expect(normalizeAudioType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(normalizeAudioType('AUDIO/OGG')).toBe('audio/ogg')
  })

  it('rechaza lo que no es audio', () => {
    expect(normalizeAudioType('application/pdf')).toBeNull()
    expect(normalizeAudioType('video/webm')).toBeNull()
  })
})
