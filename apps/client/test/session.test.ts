import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, latestSession, loadSession, saveSession } from '../src/online/session';

const first = { code: 'ABCDE', seat: 0, token: 'first-token', name: 'Ada' };
const second = { code: 'FGHJK', seat: 2, token: 'second-token', name: 'Lin' };

describe('room sessions', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a session under its room code', () => {
    saveSession(first);

    expect(loadSession('ABCDE')).toEqual(first);
  });

  it('returns the most recently saved room session', () => {
    saveSession(first);
    saveSession(second);

    expect(latestSession()).toEqual(second);
  });

  it('clears only the requested room session', () => {
    saveSession(first);
    saveSession(second);

    clearSession('ABCDE');

    expect(loadSession('ABCDE')).toBeNull();
    expect(loadSession('FGHJK')).toEqual(second);
    expect(latestSession()).toEqual(second);
  });

  it('treats unavailable localStorage as non-fatal', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => saveSession(first)).not.toThrow();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadSession('ABCDE')).toBeNull();
    expect(latestSession()).toBeNull();
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => clearSession('ABCDE')).not.toThrow();
    vi.spyOn(localStorage, 'key').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(latestSession()).toBeNull();
  });
});
