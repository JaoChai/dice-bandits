export interface AudioSettings {
  muted: boolean;
  music: number;
  sfx: number;
}

export const AUDIO_SETTINGS_KEY = 'diceBandits.audio';

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  muted: false,
  music: 0.5,
  sfx: 0.8,
};

function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function loadAudioSettings(storage?: Pick<Storage, 'getItem'> | null): AudioSettings {
  try {
    const saved = (storage === undefined ? globalThis.localStorage : storage)?.getItem(
      AUDIO_SETTINGS_KEY,
    );
    const value: unknown = saved ? JSON.parse(saved) : null;
    if (value === null || typeof value !== 'object') return { ...DEFAULT_AUDIO_SETTINGS };
    const fields = value as Partial<Record<keyof AudioSettings, unknown>>;
    return {
      muted: typeof fields.muted === 'boolean' ? fields.muted : DEFAULT_AUDIO_SETTINGS.muted,
      music: volume(fields.music, DEFAULT_AUDIO_SETTINGS.music),
      sfx: volume(fields.sfx, DEFAULT_AUDIO_SETTINGS.sfx),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    (storage === undefined ? globalThis.localStorage : storage)?.setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // Unavailable storage must not interrupt the game.
  }
}
