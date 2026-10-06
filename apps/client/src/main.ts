import '@fontsource/mitr/400.css';
import '@fontsource/mitr/600.css';
import './ui/theme.css';
import './ui/styles.css';
import Phaser from 'phaser';
import { createGame as createPhaserGame } from './game';
import { createGame, type Action, type GameEvent, type GameState } from '@dice-bandits/engine';
import { GameController } from './controller';
import { showSetup, showTitle } from './ui/screens';
import { clearSave, saveGame } from './save';
import { clearSession } from './online/session';
import { OnlineController } from './online/onlineController';
import type { RoomSocketStatus } from './online/socket';
import { testHooks } from './testHooks';
import { t } from './i18n';
import { initAudio, onGameEvents, setMusic } from './audio';
import { musicForState } from './audio/events';
import { showOnlineScreens, type OnlineSocket } from './online/screens';
import { openSoundDialog } from './ui/screens';
import { type RoomSession } from './online/session';
import type { ServerMsg } from '@dice-bandits/room';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';
import { animateThenRender } from './eventOrder';
import { renderHud } from './ui/hud';
import { renderEventToast } from './ui/dialogs';
import { renderResults } from './ui/results';
import { shake } from './fx';
import { clearForkArrows } from './scenes/board/forkArrows';
import { closeSpaceInfo } from './ui/spaceInfo';
import { createDiceyGuide } from './ui/diceyTip';

const app = getMount();
initAudio();
let game: Phaser.Game | null = null;
let diceyGuide: ReturnType<typeof createDiceyGuide> | undefined;

/** Phaser destroy is deferred; remove body-owned board UI synchronously. */
function destroyGame(): void {
  diceyGuide?.destroy();
  diceyGuide = undefined;
  closeSpaceInfo();
  clearForkArrows();
  game?.destroy(true);
  game = null;
}

/** Test-only probe: exercise the real board shake at the configured speed. */
function createArtProbe() {
  return {
    get boardReady() {
      return game?.scene.isActive('BoardScene') ?? false;
    },
    get battleReady() {
      return game?.scene.isActive('BattleScene') ?? false;
    },
    ambientRunning: false,
    shakeCount: 0,
    triggerShake: () => {
      if (game?.scene.isActive('BoardScene'))
        shake(game.scene.getScene('BoardScene'), window.diceBanditsSpeed);
    },
  };
}

/**
 * Review Focus 2: a view whose board does not match the authored map (room
 * created before a deploy) destroys the game, shows `error.boardOutdated`,
 * and returns to the title — never renders a mismatched board.
 */
function showOnlineErrorScreen(key: string): void {
  const app = getMount();
  app.innerHTML = `<main class="screen online-screen" data-testid="screen-online-error"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button></header><p class="error" role="alert" data-testid="online-error">${escapeHtml(t(key))}</p></main>`;
  app.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', () => {
    history.pushState(null, '', '/');
    showTitle(startSetup);
  });
}

/** Wire the whole-map toggle button to the live BoardScene. */
function bindMapToggle(app: HTMLElement, game: Phaser.Game, stateOf: () => GameState): void {
  app.querySelector('[data-testid="map-toggle"]')?.addEventListener('click', () => {
    const whole = !(window.diceBanditsMapWhole === true);
    window.diceBanditsMapWhole = whole;
    const scene = game.scene.getScene('BoardScene') as BoardScene | undefined;
    scene?.toggleWholeMap(stateOf(), whole);
    app
      .querySelector<HTMLButtonElement>('[data-testid="map-toggle"]')
      ?.setAttribute('aria-pressed', String(whole));
  });
}

export function startOnlineGame(
  socket: OnlineSocket,
  session: RoomSession,
  firstView: Extract<ServerMsg, { type: 'view' }>,
): void {
  destroyGame();
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;
  const guide = createDiceyGuide(app);
  diceyGuide = guide;
  let previousTipState = firstView.state;
  let tipEvents: GameEvent[] = [];
  let tipsReady = false;

  const renderOnlineHud = (): void => {
    renderHud(app, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });
    // onEvents runs before the authoritative view updates you/seats. Wait for
    // that existing view handoff, never for a tip or a new animation/timer.
    if (tipsReady && !controller.hudOnlineState.awaitingView) {
      guide.update({
        prev: previousTipState,
        next: controller.state,
        events: tipEvents,
        isLocalHuman: (seat) =>
          seat === controller.you &&
          controller.seats.find((entry) => entry.seat === seat)?.controller !== 'botTakeover',
      });
      previousTipState = controller.state;
      tipEvents = [];
    }
  };
  const showOnlineError = (key: string): void => {
    destroyGame();
    app.innerHTML = `<main class="screen online-screen" data-testid="screen-online-error"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button></header><p class="error" role="alert" data-testid="online-error">${escapeHtml(t(key))}</p></main>`;
    app.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', () => {
      history.pushState(null, '', '/');
      showTitle(startSetup);
    });
  };
  const showOnlineResults = (state: GameState): void => {
    destroyGame();
    setMusic('board');
    renderResults(
      app,
      state,
      () => {
        history.pushState(null, '', '/');
        showTitle(startSetup);
      },
      () => {
        history.pushState(null, '', '/');
        showTitle(startSetup);
      },
    );
  };
  const controller = new OnlineController({
    state: firstView.state,
    socket,
    onEvents: async (events, nextState) => {
      guide.dismiss();
      tipEvents.push(...events);
      onGameEvents(events, nextState);
      renderHud(app, nextState, (action) => void controller.dispatch(action), {
        legal: controller.legal,
        online: controller.hudOnlineState,
      });
      renderEventToast(app, events);
      const scene = game?.scene.getScene('BoardScene') as BoardScene | undefined;
      const battleScene = game?.scene.getScene('BattleScene') as BattleScene | undefined;
      await animateThenRender(
        async () => {
          await Promise.all([
            scene?.playEvents(events) ?? Promise.resolve(),
            game?.scene.isActive('BattleScene')
              ? (battleScene?.playEvents(events, window.diceBanditsSpeed) ?? Promise.resolve())
              : Promise.resolve(),
          ]);
        },
        () => {
          game?.registry.set('state', nextState);
          game?.events.emit('game-state', nextState);
          if (nextState.phase.kind === 'battle') {
            // The DOM can advance while BootScene is still loading atlases.
            // BootScene launches the current battle only after registration.
            if (game?.scene.isActive('BoardScene') && !game.scene.isActive('BattleScene'))
              scene?.scene.launch('BattleScene');
          } else if (game?.scene.isActive('BattleScene')) {
            scene?.scene.stop('BattleScene');
          }
        },
      );
    },
    onAwaitingViewChange: () => renderOnlineHud(),
  });

  const showOnlineNotice = (key: string): void => {
    app.querySelector('[data-testid="online-notice"]')?.remove();
    const notice = document.createElement('div');
    notice.className = 'game-toast';
    notice.dataset.testid = 'online-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = t(key);
    app.append(notice);
    window.setTimeout(() => notice.remove(), 3000);
  };
  const handleMessage = (message: ServerMsg): void => {
    if (message.type === 'error') {
      if (message.key === 'online.error.notFound') {
        clearSession(session.code);
        showOnlineError(message.key);
      } else showOnlineNotice(message.key);
      return;
    }
    void controller.handleMessage(message).then(() => {
      if (message.type !== 'view') return;
      if (controller.state.phase.kind === 'gameOver') showOnlineResults(controller.state);
      else renderOnlineHud();
    });
  };
  const handleStatus = (status: RoomSocketStatus): void => {
    controller.setSocketStatus(status);
    if (app.querySelector('[data-testid="screen-board"]')) renderOnlineHud();
  };
  socket.setHandlers({
    onMessage: handleMessage,
    onStatus: handleStatus,
    onTerminal: (code) => {
      if (code === 4404) clearSession(session.code);
      showOnlineError(code === 4404 ? 'online.error.notFound' : 'online.error.openedElsewhere');
    },
  });

  void controller.handleMessage(firstView).then(() => {
    if (controller.state.phase.kind === 'gameOver') {
      showOnlineResults(controller.state);
      return;
    }
    setMusic(musicForState(controller.state));
    tipsReady = true;
    renderOnlineHud();
    game = createPhaserGame('phaser-board');
    // Fork arrows (canvas) dispatch through the same controller as the DOM tray.
    game.events.on('board-chooseBranch', (to: number) => {
      void controller.dispatch({ type: 'chooseBranch', to });
    });
    game.registry.set('state', controller.state);
    window.diceBanditsMapWhole = false;
    game.registry.set('onBoardOutdated', (): void => {
      clearSession(session.code);
      showOnlineError('error.boardOutdated');
    });
    bindMapToggle(app, game, () => controller.state);
    if (import.meta.env.VITE_TEST_HOOKS === '1') {
      window.__db = {
        getState: () => controller.state,
        art: createArtProbe(),
      };
    }
    window.addEventListener('dice-bandits:lang', renderOnlineHud);
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

function openOnline(options: { mode?: 'create' | 'join'; code?: string }): void {
  setMusic('board');
  history.pushState(null, '', options.code ? `/r/${options.code}` : '/');
  showOnlineScreens({
    ...(options.mode ? { initialMode: options.mode } : {}),
    ...(options.code ? { initialCode: options.code } : {}),
    onStartGame: startOnlineGame,
  });
}

app.addEventListener('dice-bandits:online', (event) => {
  const detail = (event as CustomEvent<{ mode?: 'create' | 'join'; code?: string }>).detail;
  openOnline(detail);
});
// Board menu exit (bubbles out of the HUD's shell): tear down the game and go
// home. One module-level listener covers hot-seat and online boards; the old
// per-game `[data-action="exit"]` button no longer exists (spec §9 menu).
app.addEventListener('dice-bandits:menu-exit', () => {
  destroyGame();
  history.pushState(null, '', '/');
  showTitle(startSetup);
});
// Board menu sound-settings: the menu entry bubbles the request out of the
// game shell; the main flow owns the dialog (same one the title screen uses).
app.addEventListener('dice-bandits:sound-settings', (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-testid="audio-settings"]')
      : null;
  if (button) openSoundDialog(button);
});
app.addEventListener('dice-bandits:home', () => {
  history.pushState(null, '', '/');
  showTitle(startSetup);
});
window.addEventListener('popstate', () => {
  const roomRoute = /^\/r\/([A-Z0-9]{5})$/i.exec(location.pathname);
  if (roomRoute) openOnline({ code: roomRoute[1]!.toUpperCase() });
  else showTitle(startSetup);
});

function getMount(): HTMLElement {
  const mount = document.querySelector<HTMLElement>('#app');
  if (!mount) throw new Error('Missing #app mount element');
  return mount;
}

function startSetup(): void {
  showSetup((config) => {
    clearSave();
    const seed = testHooks.seed ?? config.seed;
    const state = createGame({ ...config, seed, rounds: 12 });
    startGame(state);
  });
}

function startGame(state: GameState): void {
  destroyGame();
  if (state.phase.kind === 'gameOver') {
    setMusic('board');
    renderResults(app, state, startSetup, () => showTitle(startSetup));
    return;
  }
  setMusic(musicForState(state));
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;
  const guide = createDiceyGuide(app);
  diceyGuide = guide;
  let previousTipState = state;
  const isLocalHuman = (seat: number): boolean =>
    controller.state.players[seat]?.control === 'human';
  const controller = new GameController({
    state,
    speed: testHooks.speed,
    onEvents: async (events, nextState) => {
      onGameEvents(events, nextState);
      renderHud(app, nextState, dispatch);
      guide.update({ prev: previousTipState, next: nextState, events, isLocalHuman });
      previousTipState = nextState;
      renderEventToast(app, events);
      const scene = game?.scene.getScene('BoardScene') as BoardScene | undefined;
      const battleScene = game?.scene.getScene('BattleScene') as BattleScene | undefined;
      await animateThenRender(
        async () => {
          await Promise.all([
            scene?.playEvents(events) ?? Promise.resolve(),
            game?.scene.isActive('BattleScene')
              ? (battleScene?.playEvents(events, window.diceBanditsSpeed) ?? Promise.resolve())
              : Promise.resolve(),
          ]);
        },
        () => {
          game?.registry.set('state', nextState);
          game?.events.emit('game-state', nextState);
          if (nextState.phase.kind === 'battle') {
            // The DOM can advance while BootScene is still loading atlases.
            // BootScene launches the current battle only after registration.
            if (game?.scene.isActive('BoardScene') && !game.scene.isActive('BattleScene'))
              scene?.scene.launch('BattleScene');
          } else if (game?.scene.isActive('BattleScene')) {
            scene?.scene.stop('BattleScene');
          }
        },
      );
      if (nextState.phase.kind === 'gameOver') {
        destroyGame();
        setMusic('board');
        renderResults(app, nextState, startSetup, () => {
          showTitle(startSetup);
        });
      }
    },
  });
  function dispatch(action: Action): void {
    void controller.dispatch(action);
  }
  // The HUD mounts `#phaser-board`; Phaser must be created after it exists.
  renderHud(app, controller.state, dispatch);
  guide.update({ prev: state, next: controller.state, events: [], isLocalHuman });
  game = createPhaserGame('phaser-board');
  game.events.on('board-chooseBranch', (to: number) => {
    void controller.dispatch({ type: 'chooseBranch', to });
  });
  game.registry.set('state', state);
  window.diceBanditsMapWhole = false;
  game.registry.set('onBoardOutdated', (): void => {
    destroyGame();
    showOnlineErrorScreen('error.boardOutdated');
  });
  bindMapToggle(app, game, () => controller.state);
  if (import.meta.env.VITE_TEST_HOOKS === '1') {
    window.__db = {
      getState: () => controller.state,
      art: createArtProbe(),
    };
  }
  window.addEventListener('dice-bandits:lang', () => renderHud(app, controller.state, dispatch));
  saveGame(controller.state);
}

app.addEventListener('dice-bandits:continue', (event) => {
  const state = (event as CustomEvent<GameState>).detail;
  if (state) startGame(state);
});

declare global {
  interface Window {
    __db?: {
      getState: () => GameState;
      art: {
        readonly boardReady: boolean;
        readonly battleReady: boolean;
        ambientRunning: boolean;
        shakeCount: number;
        backdropKey?: string;
        triggerShake?: () => void;
      };
    };
    diceBanditsText: (key: string) => string;
    diceBanditsSpeed: number;
    diceBanditsMapWhole?: boolean;
  }
}

if (testHooks.enabled && testHooks.seed)
  history.replaceState(
    null,
    '',
    `?seed=${encodeURIComponent(testHooks.seed)}&speed=${testHooks.speed}`,
  );
const initialRoom = /^\/r\/([A-Z0-9]{5})$/i.exec(location.pathname);
if (initialRoom) openOnline({ code: initialRoom[1]!.toUpperCase() });
else showTitle(startSetup);
