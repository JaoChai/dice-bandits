import { createGame, type GameConfig, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@dice-bandits/room';
import { setLang, t } from '../src/i18n';
import { saveSession } from '../src/online/session';
import type { RoomSocketOptions } from '../src/online/socket';
import { showOnlineScreens, type OnlineSocket } from '../src/online/screens';
import { passDeviceMarkup } from '../src/ui/passDevice';
import { renderResults } from '../src/ui/results';
import { showSetup, showTitle } from '../src/ui/screens';
import { showActionDialog, showPhaseDialog } from '../src/ui/dialogs';

const gameConfig: GameConfig = {
  seed: 'reskin-test',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};

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

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.querySelector<HTMLElement>('#app')!;
}

function withPhase(phase: GameState['phase']): GameState {
  const state = createGame(gameConfig);
  state.phase = phase;
  return state;
}

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  localStorage.clear();
  setLang('en');
  vi.restoreAllMocks();
});

describe('pixel frame re-skin', () => {
  it('title shows the pixel logo', () => {
    mount();
    showTitle();
    const logo = document.querySelector<HTMLElement>('.logo-pixel');
    expect(logo).not.toBeNull();
    expect(logo?.textContent).toBe(t('title.gameName'));
  });

  it('setup shows a class portrait for every seat', () => {
    mount();
    showSetup(vi.fn());
    const portraits = document.querySelectorAll<HTMLElement>('.seat-row .seat-portrait');
    expect(portraits).toHaveLength(4);
    expect([...portraits].map((portrait) => portrait.className)).toEqual([
      'seat-portrait portrait-knight',
      'seat-portrait portrait-thief',
      'seat-portrait portrait-mage',
      'seat-portrait portrait-cleric',
    ]);
    portraits.forEach((portrait) => {
      expect(portrait.getAttribute('role')).toBe('img');
      expect(portrait.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('perk dialog uses the pixel frame and keeps its perk test ids', () => {
    const root = mount();
    const dispatch = vi.fn();
    showPhaseDialog(
      root,
      withPhase({ kind: 'levelUp', seat: 0, choices: ['hpUp', 'atkUp'], then: 'endTurn' }),
      [
        { type: 'pickPerk', perk: 'hpUp' },
        { type: 'pickPerk', perk: 'atkUp' },
      ],
      dispatch,
    );
    expect(document.querySelector('.game-dialog.frame')).not.toBeNull();
    expect(document.querySelector('[data-testid="perk-hpUp"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="perk-atkUp"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="perk-atkUp"]')!.click();
    expect(dispatch).toHaveBeenCalledWith({ type: 'pickPerk', perk: 'atkUp' });
  });

  it('shop dialog uses the pixel frame and keeps its shop test ids', () => {
    const root = mount();
    showPhaseDialog(
      root,
      withPhase({ kind: 'shop', stock: ['potion'] }),
      [{ type: 'shopBuy', item: 'potion' }, { type: 'leave' }],
      vi.fn(),
    );
    expect(document.querySelector('.game-dialog.frame')).not.toBeNull();
    expect(document.querySelector('[data-testid="shop-shopBuy-potion"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shop-leave-leave"]')).not.toBeNull();
  });

  it('reward dialog uses the pixel frame', () => {
    const root = mount();
    showActionDialog(
      root,
      [{ type: 'pvpReward', reward: 'rob', item: null, townId: null, alias: null }],
      vi.fn(),
    );
    expect(document.querySelector('.game-dialog.frame')).not.toBeNull();
  });

  it('results screen uses the pixel frame', () => {
    const root = mount();
    const state = withPhase({
      kind: 'gameOver',
      ranking: [0, 1],
      winners: [0],
      highlights: [],
    });
    renderResults(
      root,
      state,
      () => {},
      () => {},
    );
    expect(document.querySelector('.results-screen.frame')).not.toBeNull();
    expect(document.querySelector('[data-testid="results"]')).not.toBeNull();
  });

  it('pass-device dialog uses the pixel frame', () => {
    mount().innerHTML = passDeviceMarkup('Ada');
    expect(document.querySelector('.game-dialog.frame')).not.toBeNull();
    expect(document.querySelector('[data-testid="pass-screen"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="pass-ready"]')).not.toBeNull();
  });

  it('lobby uses the pixel frame and keeps its seat row ids', async () => {
    mount();
    saveSession({ code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' });
    showOnlineScreens({
      fetcher: vi.fn(),
      socketFactory,
      onStartGame: vi.fn(),
      initialCode: 'ABCDE',
    });
    socket.receive({
      type: 'lobby',
      code: 'ABCDE',
      host: 0,
      seats: [
        {
          seat: 0,
          name: 'Ada',
          classId: 'knight',
          kind: 'human',
          controller: 'player',
          connected: true,
        },
      ],
    });
    expect(document.querySelector('.screen.online-screen.frame')).not.toBeNull();
    expect(document.querySelector('[data-testid="lobby-seat-0"]')).not.toBeNull();
  });

  it('title and setup screens use the pixel frame', () => {
    mount();
    showTitle();
    expect(document.querySelector('.screen.title-screen.frame')).not.toBeNull();
    showSetup(vi.fn());
    expect(document.querySelector('.screen.setup-screen.frame')).not.toBeNull();
  });
});
