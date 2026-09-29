import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicSeat, ServerMsg } from '@dice-bandits/room';
import { setLang, t } from '../src/i18n';
import { showTitle } from '../src/ui/screens';
import { saveSession } from '../src/online/session';
import { showOnlineScreens, type OnlineSocket } from '../src/online/screens';
import type { RoomSocketOptions } from '../src/online/socket';

const seat = (overrides: Partial<PublicSeat> = {}): PublicSeat => ({
  seat: 0,
  name: 'Ada',
  classId: 'knight',
  kind: 'human',
  controller: 'player',
  connected: true,
  ...overrides,
});

class FakeSocket implements OnlineSocket {
  constructor(options: RoomSocketOptions) {
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
    this.onTerminal = options.onTerminal;
  }
  sent: unknown[] = [];
  close = vi.fn();
  onMessage: (message: ServerMsg) => void;
  onStatus: RoomSocketOptions['onStatus'];
  onTerminal: RoomSocketOptions['onTerminal'];
  setHandlers(handlers: Pick<RoomSocketOptions, 'onMessage' | 'onStatus' | 'onTerminal'>): void {
    this.onMessage = handlers.onMessage;
    this.onStatus = handlers.onStatus;
    this.onTerminal = handlers.onTerminal;
  }
  send(message: Parameters<OnlineSocket['send']>[0]): void {
    this.sent.push(message);
  }
  receive(message: ServerMsg): void {
    this.onMessage(message);
  }
}

let socket: FakeSocket;
const socketFactory = vi.fn((options: RoomSocketOptions) => {
  socket = new FakeSocket(options);
  return socket;
});

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  socketFactory.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
  history.replaceState(null, '', '/');
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('online screens', () => {
  it('shows create, join and the latest saved room on the title screen', () => {
    saveSession({ code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' });
    showTitle();

    expect(document.querySelector('[data-testid="online-create"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="online-join"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="online-back"]')?.textContent).toContain('ABCDE');
  });

  it('shows a translated rate-limit message when room creation is throttled', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'online.error.rateLimited' }, { status: 429 }));
    showOnlineScreens({ fetcher, socketFactory, onStartGame: vi.fn() });
    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Ada';
    document.querySelector<HTMLButtonElement>('[data-testid="online-create-submit"]')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="online-error"]')?.textContent).toContain(
        'Too many rooms created. Try again in a moment.',
      ),
    );
  });

  it('creates a room, stores its session and opens its lobby', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 'ABCDE', seat: 0, token: 'secret' }, { status: 201 }),
      );
    showOnlineScreens({ fetcher, socketFactory, onStartGame: vi.fn() });
    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Ada';
    document.querySelector<HTMLButtonElement>('[data-testid="online-create-submit"]')!.click();
    await vi.waitFor(() => expect(socketFactory).toHaveBeenCalledOnce());

    expect(fetcher).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({ method: 'POST' }));
    expect(localStorage.getItem('dice-bandits:room:ABCDE')).toContain('secret');
    socket.receive({ type: 'lobby', code: 'ABCDE', host: 0, seats: [seat()] });
    expect(document.querySelector('[data-testid="screen-lobby"]')).not.toBeNull();
  });

  it('uppercases and limits the join code and sends the visitor join message', async () => {
    const fetcher = vi.fn();
    showOnlineScreens({ fetcher, socketFactory, onStartGame: vi.fn(), initialMode: 'join' });
    const code = document.querySelector<HTMLInputElement>('[data-testid="online-code"]')!;
    code.value = 'ab!cdef';
    code.dispatchEvent(new Event('input', { bubbles: true }));
    expect(code.value).toBe('ABCDE');

    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Lin';
    document.querySelector<HTMLButtonElement>('[data-testid="online-join-submit"]')!.click();
    await vi.waitFor(() => expect(socketFactory).toHaveBeenCalledOnce());
    expect(socketFactory).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/api/rooms/ABCDE/ws') }),
    );
    expect(socket.sent).toContainEqual({ type: 'join', name: 'Lin' });
  });

  it('opens an invite route with its room code ready to join', () => {
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'abcde',
    });
    expect(document.querySelector<HTMLInputElement>('[data-testid="online-code"]')!.value).toBe(
      'ABCDE',
    );
    socket.receive({ type: 'lobby', code: 'ABCDE', host: 0, seats: [seat()] });
    expect(document.querySelector('[data-testid="online-form"]')).not.toBeNull();
  });

  it('keeps a typed name on the invite form when lobby updates arrive', () => {
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'ABCDE',
    });
    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Lin';
    socket.receive({ type: 'lobby', code: 'ABCDE', host: 0, seats: [seat()] });
    socket.receive({
      type: 'lobby',
      code: 'ABCDE',
      host: 0,
      seats: [seat(), seat({ seat: 1, name: 'Bo' })],
    });
    expect(document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value).toBe(
      'Lin',
    );
  });

  it('renders lobby seats, lets a player choose class and only lets the host start', () => {
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialMode: 'join',
    });
    document.querySelector<HTMLInputElement>('[data-testid="online-code"]')!.value = 'ABCDE';
    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Lin';
    document.querySelector<HTMLButtonElement>('[data-testid="online-join-submit"]')!.click();
    socket.receive({ type: 'welcome', seat: 1, token: 'new-token' });
    socket.receive({
      type: 'lobby',
      code: 'ABCDE',
      host: 0,
      seats: [seat(), seat({ seat: 1, name: 'Lin', classId: 'mage' })],
    });
    expect(document.querySelector('[data-testid="screen-lobby"]')?.textContent).toContain('Ada');
    expect(document.querySelector('[data-testid="screen-lobby"]')?.textContent).toContain('Host');
    expect(document.querySelector('[data-testid="lobby-start"]')).toBeNull();
    const thiefClass = document.querySelector<HTMLButtonElement>(
      '[data-testid="lobby-class-thief"]',
    )!;
    thiefClass.focus();
    thiefClass.click();
    expect(socket.sent).toContainEqual({ type: 'setClass', classId: 'thief' });
    socket.receive({
      type: 'lobby',
      code: 'ABCDE',
      host: 0,
      seats: [seat(), seat({ seat: 1, name: 'Lin', classId: 'thief' })],
    });
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="lobby-class-thief"]'),
    );
  });

  it('lets the host start and hands the first view to the online-game hook', () => {
    const onStartGame = vi.fn();
    showOnlineScreens({ fetcher: vi.fn(), socketFactory, onStartGame, initialMode: 'join' });
    document.querySelector<HTMLInputElement>('[data-testid="online-code"]')!.value = 'ABCDE';
    document.querySelector<HTMLInputElement>('[data-testid="online-name"]')!.value = 'Ada';
    document.querySelector<HTMLButtonElement>('[data-testid="online-join-submit"]')!.click();
    socket.receive({ type: 'welcome', seat: 0, token: 'host-token' });
    socket.receive({ type: 'lobby', code: 'ABCDE', host: 0, seats: [seat()] });
    document.querySelector<HTMLButtonElement>('[data-testid="lobby-start"]')!.click();
    expect(socket.sent).toContainEqual({ type: 'start' });

    const firstView: Extract<ServerMsg, { type: 'view' }> = {
      type: 'view',
      turn: 1,
      state: {} as never,
      you: 0,
      legal: [],
      seats: [seat()],
      opponentPicked: false,
    };
    socket.receive(firstView);
    expect(onStartGame).toHaveBeenCalledWith(
      socket,
      expect.objectContaining({ seat: 0, token: 'host-token' }),
      firstView,
    );
  });

  it('offers only bot-held human seats to claim and gives feedback when none exist', () => {
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'ABCDE',
    });
    socket.receive({ type: 'seats', seats: [seat({ controller: 'botTakeover' })] });
    expect(document.querySelector('[data-testid="screen-claim"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="claim-seat-0"]')).not.toBeNull();

    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'FGHJK',
    });
    socket.receive({ type: 'seats', seats: [seat({ kind: 'bot', controller: 'bot' })] });
    expect(document.querySelector('[data-testid="screen-claim"]')?.textContent).toContain(
      t('online.claim.none'),
    );
  });

  it('tells a device whose saved seat was claimed elsewhere, and forgets that seat', () => {
    saveSession({ code: 'ABCDE', seat: 1, token: 'old-token', name: 'Bo' });
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'ABCDE',
    });
    // A rejected token makes the server treat this device as an unseated visitor.
    socket.receive({ type: 'seats', seats: [seat({ seat: 1, name: 'Cy' })] });
    expect(document.querySelector('[data-testid="online-error"]')?.textContent).toContain(
      t('online.error.openedElsewhere'),
    );
    expect(document.querySelector('[data-testid="screen-claim"]')).toBeNull();
    expect(localStorage.getItem('dice-bandits:room:ABCDE')).toBeNull();
  });

  it.each(['en', 'th'] as const)('renders translated errors in %s', (language) => {
    setLang(language);
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'ABCDE',
    });
    for (const key of [
      'online.error.notFound',
      'online.error.gameStarted',
      'online.error.roomFull',
      'online.error.cannotClaim',
    ]) {
      socket.receive({ type: 'error', key });
      expect(document.querySelector('[data-testid="online-error"]')?.textContent).toContain(t(key));
    }
  });
});
