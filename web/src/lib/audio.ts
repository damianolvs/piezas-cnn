let context: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!context) {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    context = new AudioContextClass()
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {})
  }
  return context
}

export function unlockAudio(): void {
  getContext()
}

interface ToneOptions {
  frequency?: number
  duration?: number
  volume?: number
  type?: OscillatorType
}

export function tone({
  frequency = 660,
  duration = 0.08,
  volume = 0.05,
  type = "sine",
}: ToneOptions = {}): void {
  const audio = getContext()
  if (!audio) return

  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  const now = audio.currentTime

  oscillator.type = type
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  oscillator.connect(gain)
  gain.connect(audio.destination)
  oscillator.start(now)
  oscillator.stop(now + duration + 0.02)
}

export function beepCountdown(n: number): void {
  tone({ frequency: n <= 1 ? 880 : 620, duration: 0.09, volume: 0.05 })
}

export function beepGo(): void {
  tone({ frequency: 1040, duration: 0.16, volume: 0.05 })
}

export function shutter(index: number): void {
  tone({
    frequency: index % 5 === 0 ? 1320 : 1080,
    duration: 0.025,
    volume: 0.022,
    type: "triangle",
  })
}
