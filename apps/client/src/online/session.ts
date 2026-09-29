export interface RoomSession {
  code: string;
  seat: number;
  token: string;
  name: string;
}

const SESSION_PREFIX = 'dice-bandits:room:';

interface StoredSession {
  session: RoomSession;
  savedAt: number;
}

export function saveSession(session: RoomSession): void {
  try {
    const savedAt = Math.max(Date.now(), latestSavedAt() + 1);
    localStorage.setItem(sessionKey(session.code), JSON.stringify({ session, savedAt }));
  } catch {
    // Persistence is optional; keep the room playable when storage is unavailable.
  }
}

export function loadSession(code: string): RoomSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(code));
    if (raw === null) return null;
    return parseStoredSession(raw)?.session ?? null;
  } catch {
    return null;
  }
}

export function latestSession(): RoomSession | null {
  try {
    let latest: StoredSession | null = null;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(SESSION_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const stored = parseStoredSession(raw);
      if (stored !== null && (latest === null || stored.savedAt > latest.savedAt)) latest = stored;
    }
    return latest?.session ?? null;
  } catch {
    return null;
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(sessionKey(code));
  } catch {
    // Ignore storage failures so the caller can continue.
  }
}

function latestSavedAt(): number {
  let latest = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || !key.startsWith(SESSION_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const stored = parseStoredSession(raw);
    if (stored !== null) latest = Math.max(latest, stored.savedAt);
  }
  return latest;
}

function sessionKey(code: string): string {
  return `${SESSION_PREFIX}${code}`;
}

function parseStoredSession(raw: string): StoredSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isRecord(value.session) || typeof value.savedAt !== 'number')
      return null;
    const session = value.session;
    if (
      typeof session.code !== 'string' ||
      typeof session.seat !== 'number' ||
      typeof session.token !== 'string' ||
      typeof session.name !== 'string'
    )
      return null;
    return {
      session: {
        code: session.code,
        seat: session.seat,
        token: session.token,
        name: session.name,
      },
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
