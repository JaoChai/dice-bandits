const enabled = import.meta.env.VITE_TEST_HOOKS === '1';

export function recordAudioStart(id: string): void {
  if (!enabled) return;
  try {
    (window.__audioLog ??= []).push(id);
  } catch {
    // A missing window must never break audio playback.
  }
}
