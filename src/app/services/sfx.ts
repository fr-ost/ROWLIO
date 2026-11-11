// Interface sound effects, synthesised with the Web Audio API.
// No audio files, no network: every sound is a few oscillator notes generated on the spot.
// Sounds are short and quiet by design, and can be switched off in Settings.

export type Sfx = 'tap' | 'nav' | 'toggle' | 'success' | 'complete' | 'error' | 'warning' | 'info' | 'start' | 'delete' | 'pop';

interface Note {
  /** Frequency in Hz (start). */
  f: number;
  /** Optional frequency to glide to. */
  to?: number;
  /** Start offset in seconds. */
  at: number;
  /** Duration in seconds. */
  d: number;
  /** Peak gain 0–1 (before the master volume). */
  g: number;
  type?: OscillatorType;
}

const SOUNDS: Record<Sfx, Note[]> = {
  tap: [{ f: 880, to: 660, at: 0, d: 0.045, g: 0.35, type: 'triangle' }],
  nav: [{ f: 620, to: 930, at: 0, d: 0.07, g: 0.3, type: 'sine' }],
  toggle: [
    { f: 520, at: 0, d: 0.05, g: 0.3, type: 'triangle' },
    { f: 780, at: 0.05, d: 0.06, g: 0.3, type: 'triangle' },
  ],
  pop: [{ f: 440, to: 880, at: 0, d: 0.09, g: 0.4, type: 'sine' }],
  info: [{ f: 740, at: 0, d: 0.12, g: 0.3, type: 'sine' }],
  start: [
    { f: 392, at: 0, d: 0.09, g: 0.4, type: 'triangle' },
    { f: 523.25, at: 0.08, d: 0.09, g: 0.4, type: 'triangle' },
    { f: 783.99, at: 0.16, d: 0.14, g: 0.4, type: 'triangle' },
  ],
  success: [
    { f: 659.25, at: 0, d: 0.1, g: 0.45, type: 'sine' },
    { f: 987.77, at: 0.09, d: 0.2, g: 0.45, type: 'sine' },
  ],
  complete: [
    { f: 523.25, at: 0, d: 0.12, g: 0.4, type: 'sine' },
    { f: 659.25, at: 0.1, d: 0.12, g: 0.4, type: 'sine' },
    { f: 783.99, at: 0.2, d: 0.12, g: 0.4, type: 'sine' },
    { f: 1046.5, at: 0.3, d: 0.34, g: 0.45, type: 'sine' },
  ],
  warning: [
    { f: 587.33, at: 0, d: 0.11, g: 0.4, type: 'triangle' },
    { f: 466.16, at: 0.12, d: 0.16, g: 0.4, type: 'triangle' },
  ],
  error: [
    { f: 311.13, at: 0, d: 0.13, g: 0.45, type: 'sawtooth' },
    { f: 233.08, at: 0.13, d: 0.22, g: 0.45, type: 'sawtooth' },
  ],
  delete: [{ f: 520, to: 180, at: 0, d: 0.16, g: 0.35, type: 'triangle' }],
};

const MASTER_VOLUME = 0.16;

let enabled = true;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayed = 0;

function audio(): { context: AudioContext; master: GainNode } | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    if (!context) {
      context = new Ctor();
      // A gentle low-pass keeps the harsher waveforms soft.
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 5200;
      master = context.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(filter);
      filter.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume();
    return { context, master: master! };
  } catch {
    return null;
  }
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function playSfx(name: Sfx): void {
  if (!enabled) return;
  const now = Date.now();
  // Bursts of events (several toasts at once) should not stack into noise.
  if (name !== 'complete' && now - lastPlayed < 45) return;
  lastPlayed = now;
  const out = audio();
  if (!out) return;
  const start = out.context.currentTime + 0.005;
  for (const note of SOUNDS[name]) {
    const oscillator = out.context.createOscillator();
    const gain = out.context.createGain();
    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.setValueAtTime(note.f, start + note.at);
    if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.at + note.d);
    gain.gain.setValueAtTime(0.0001, start + note.at);
    gain.gain.exponentialRampToValueAtTime(note.g, start + note.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.d);
    oscillator.connect(gain);
    gain.connect(out.master);
    oscillator.start(start + note.at);
    oscillator.stop(start + note.at + note.d + 0.03);
  }
}

let installed = false;

/**
 * Give ordinary controls a quiet click without touching every component: one delegated
 * listener decides from the element that was activated.
 */
export function installUiSounds(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const control = target?.closest?.('button, a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="radio"], [role="tab"], input[type="checkbox"], summary');
      if (!control || (control as HTMLButtonElement).disabled) return;
      if (control.closest('nav')) playSfx('nav');
      else if (control.matches('input[type="checkbox"], [role="radio"], [role="menuitemcheckbox"]')) playSfx('toggle');
      else playSfx('tap');
    },
    true,
  );
}
