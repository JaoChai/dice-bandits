import { describe, expect, it } from 'vitest';
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
} from '../../src/audio/settings';

const defaults = { muted: false, music: 0.5, sfx: 0.8 };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('audio settings persistence', () => {
  it('returns the defaults when storage is explicitly unavailable', () => {
    expect(AUDIO_SETTINGS_KEY).toBe('diceBandits.audio');
    expect(DEFAULT_AUDIO_SETTINGS).toEqual(defaults);
    expect(loadAudioSettings(null)).toEqual(defaults);
    expect(() => saveAudioSettings(defaults, null)).not.toThrow();
  });

  it('saves and reloads settings through the audio key', () => {
    const storage = memoryStorage();
    const settings = { muted: true, music: 0, sfx: 1 };
    saveAudioSettings(settings, storage);
    expect(storage.getItem('diceBandits.audio')).toBe(JSON.stringify(settings));
    expect(loadAudioSettings(storage)).toEqual(settings);
  });

  it('returns defaults for malformed JSON', () => {
    expect(loadAudioSettings({ getItem: () => '{bad' })).toEqual(defaults);
  });

  it('clamps out-of-range volumes and defaults malformed fields independently', () => {
    expect(loadAudioSettings({ getItem: () => '{"muted":true,"music":7,"sfx":"x"}' })).toEqual({
      muted: true,
      music: 1,
      sfx: 0.8,
    });
  });

  it('defaults missing and non-finite fields while preserving valid zero', () => {
    expect(loadAudioSettings({ getItem: () => '{"music":0,"sfx":null}' })).toEqual({
      muted: false,
      music: 0,
      sfx: 0.8,
    });
    expect(loadAudioSettings({ getItem: () => '{"muted":"yes","sfx":-5}' })).toEqual({
      muted: false,
      music: 0.5,
      sfx: 0,
    });
  });

  it('returns defaults when storage throws while reading', () => {
    expect(
      loadAudioSettings({
        getItem: () => {
          throw new Error('storage unavailable');
        },
      }),
    ).toEqual(defaults);
  });

  it('does not throw when storage rejects a write', () => {
    expect(() =>
      saveAudioSettings(defaults, {
        setItem: () => {
          throw new Error('storage unavailable');
        },
      }),
    ).not.toThrow();
  });
});
