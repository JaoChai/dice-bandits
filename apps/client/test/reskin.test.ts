import { createGame, type GameConfig, type GameState } from '@dice-bandits/engine';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@dice-bandits/room';
import { setLang } from '../src/i18n';
import { saveSession } from '../src/online/session';
import type { RoomSocketOptions } from '../src/online/socket';
import { showOnlineScreens, type OnlineSocket } from '../src/online/screens';
import { passDeviceMarkup } from '../src/ui/passDevice';
import { renderResults } from '../src/ui/results';
import { renderHud } from '../src/ui/hud';
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

describe('cartoon re-skin', () => {
  it('title uses the title atlas key art as its background', () => {
    mount();
    showTitle();
    const screen = document.querySelector<HTMLElement>('.title-screen');
    expect(screen).not.toBeNull();
    expect(screen?.style.backgroundImage).toContain('/art/title.webp');
    expect(document.querySelector('.logo-pixel')).toBeNull();
  });

  it('drops the pixel fonts: Mitr is wired in, Press Start 2P and Chakra Petch are gone', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain('@fontsource/mitr/400.css');
    expect(main).toContain('@fontsource/mitr/600.css');
    expect(main).not.toContain('press-start-2p');
    expect(main).not.toContain('chakra-petch');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@fontsource/mitr']).toBe('5.3.0');
    expect(pkg.dependencies).not.toHaveProperty('@fontsource/press-start-2p');
    expect(pkg.dependencies).not.toHaveProperty('@fontsource/chakra-petch');
    const cssPath = new URL('./src/ui/frame.css', import.meta.url).pathname;
    expect(() => readFileSync(cssPath, 'utf8')).toThrow();
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

  it('perk dialog uses the cartoon card and keeps its perk test ids', () => {
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
    expect(document.querySelector('.game-dialog.card')).not.toBeNull();
    expect(document.querySelector('[data-testid="perk-hpUp"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="perk-atkUp"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="perk-atkUp"]')!.click();
    expect(dispatch).toHaveBeenCalledWith({ type: 'pickPerk', perk: 'atkUp' });
  });

  it('shop dialog uses the cartoon card and keeps its shop test ids', () => {
    const root = mount();
    showPhaseDialog(
      root,
      withPhase({ kind: 'shop', stock: ['potion'] }),
      [{ type: 'shopBuy', item: 'potion' }, { type: 'leave' }],
      vi.fn(),
    );
    expect(document.querySelector('.game-dialog.card')).not.toBeNull();
    expect(document.querySelector('[data-testid="shop-shopBuy-potion"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shop-leave-leave"]')).not.toBeNull();
  });

  it('reward dialog uses the cartoon card', () => {
    const root = mount();
    showActionDialog(
      root,
      [{ type: 'pvpReward', reward: 'rob', item: null, townId: null, alias: null }],
      vi.fn(),
    );
    expect(document.querySelector('.game-dialog.card')).not.toBeNull();
  });

  it('results screen uses the cartoon card', () => {
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
    expect(document.querySelector('.results-screen.card')).not.toBeNull();
    expect(document.querySelector('[data-testid="results"]')).not.toBeNull();
  });

  it('pass-device dialog uses the cartoon card', () => {
    mount().innerHTML = passDeviceMarkup('Ada');
    expect(document.querySelector('.game-dialog.card')).not.toBeNull();
    expect(document.querySelector('[data-testid="pass-screen"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="pass-ready"]')).not.toBeNull();
  });

  it('lobby uses the cartoon card and keeps its seat row ids', async () => {
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
    expect(document.querySelector('.screen.online-screen.card')).not.toBeNull();
    expect(document.querySelector('[data-testid="lobby-seat-0"]')).not.toBeNull();
  });

  it('title and setup screens use the cartoon card', () => {
    mount();
    showTitle();
    expect(document.querySelector('.screen.title-screen.card')).not.toBeNull();
    showSetup(vi.fn());
    expect(document.querySelector('.screen.setup-screen.card')).not.toBeNull();
  });

  it('styles.css defines the .card cartoon surface from the theme tokens', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(new RegExp('\\.card\\s*\\{[^}]*var\\(--t-panel', 's').test(css)).toBe(true);
    expect(new RegExp('\\.card\\s*\\{[^}]*var\\(--t-outline', 's').test(css)).toBe(true);
  });

  it('styles.css uses the cream/cocoa surfaces instead of the old dark palette', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    // The old pixel-era navy/purple surfaces must be gone from the shared
    // chrome (screens, dialogs, buttons); token vars or palette hex only.
    for (const oldSurface of ['#302039', '#171324', '#201a30', '#1b2140', '#292238']) {
      expect(css, `old dark surface ${oldSurface} must not remain in styles.css`).not.toContain(
        oldSurface,
      );
    }
  });

  it('body is cream (theme.css wins, no dark radial gradient in styles.css)', () => {
    const stylesCss = readFileSync('src/ui/styles.css', 'utf8');
    expect(stylesCss).not.toContain('radial-gradient');
    const themeCss = readFileSync('src/ui/theme.css', 'utf8');
    expect(themeCss).toContain('body');
  });

  it('title art fills the screen: background-size cover + center position', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const block = /\.title-screen\s*\{[^}]*\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block![0]).toContain('background-size: cover');
    expect(block![0]).toContain('background-position: center');
  });

  it('buttons have normal/pressed/disabled cartoon states from the tokens', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    // Chunky rounded buttons: base state + :hover/:active (pressed) + :disabled.
    const primary = /\.primary\s*,\s*\.secondary\s*\{[^}]*\}/.exec(css);
    expect(primary).not.toBeNull();
    expect(primary![0]).toContain('var(--c-orange)');
    expect(css).toMatch(/\.primary:active\s*,\s*\.secondary:active\s*\{/);
    expect(css).toMatch(/\.primary:disabled\s*,\s*\.secondary:disabled\s*\{/);
  });

  it('mounts a coin pill and heart HP meter on every rendered seat card', () => {
    const root = document.createElement('div');
    const state = createGame(gameConfig);
    state.players[0]!.hp = state.players[0]!.stats.maxHp / 2;
    renderHud(root, state, () => undefined);
    const cards = [...root.querySelectorAll('.seat-card')];
    expect(cards).toHaveLength(state.players.length);
    cards.forEach((card, seat) => {
      const player = state.players[seat]!;
      const gold = card.querySelector('.gold-pill');
      expect(gold, `seat ${seat} mounts its coin pill`).not.toBeNull();
      expect(gold?.textContent).toContain(String(player.gold));
      expect(gold?.getAttribute('aria-label')).toContain(String(player.gold));
      card.querySelector<HTMLButtonElement>('[data-seat-open]')!.click();
      const health = root.querySelector('[data-testid="seat-detail-panel"] .seat-health');
      expect(health?.getAttribute('role')).toBe('meter');
      expect(health?.getAttribute('aria-valuenow')).toBe(String(player.hp));
      expect(health?.getAttribute('aria-valuemax')).toBe(String(player.stats.maxHp));
      expect(health?.querySelector('svg.hp-heart path')?.getAttribute('d')).toBeTruthy();
      expect(health?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(health?.querySelector<HTMLElement>('.hp-track span')?.style.width).toBe(
        seat === 0 ? '50%' : '100%',
      );
      root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    });
  });
});
