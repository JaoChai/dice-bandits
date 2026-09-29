import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/press-start-2p/400.css';
import './ui/styles.css';
import Phaser from 'phaser';
import { createGame, type Action, type GameState } from '@dice-bandits/engine';
import { GameController } from './controller';
import { showSetup, showTitle } from './ui/screens';
import { clearSave, saveGame } from './save';
import { clearSession } from './online/session';
import { OnlineController } from './online/onlineController';
import type { RoomSocketStatus } from './online/socket';
import { testHooks } from './testHooks';
import { t } from './i18n';
import { showOnlineScreens, type OnlineSocket } from './online/screens';
import { type RoomSession } from './online/session';
import type { ServerMsg } from '@dice-bandits/room';
import BootScene from './scenes/BootScene';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';
import { animateThenRender } from './eventOrder';
import { renderHud } from './ui/hud';
import { renderEventToast } from './ui/dialogs';
import { renderResults } from './ui/results';

const app = getMount();
let game: Phaser.Game | null = null;

export function startOnlineGame(
  socket: OnlineSocket,
  session: RoomSession,
  firstView: Extract<ServerMsg, { type: 'view' }>,
): void {
  game?.destroy(true);
  game = null;
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;

  const renderOnlineHud = (): void => {
    renderHud(app, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });
  };
  const showOnlineError = (key: string): void => {
    game?.destroy(true);
    game = null;
    app.innerHTML = `<main class="screen online-screen" data-testid="screen-online-error"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button></header><p class="error" role="alert" data-testid="online-error">${escapeHtml(t(key))}</p></main>`;
    app.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', () => {
      history.pushState(null, '', '/');
      showTitle(startSetup);
    });
  };
  const showOnlineResults = (state: GameState): void => {
    game?.destroy(true);
    game = null;
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
            if (!game?.scene.isActive('BattleScene')) scene?.scene.launch('BattleScene');
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
    renderOnlineHud();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'phaser-board',
      width: 640,
      height: 360,
      backgroundColor: '#273449',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [BootScene, BoardScene, BattleScene],
    });
    game.registry.set('state', controller.state);
    app.querySelector('[data-action="exit"]')?.addEventListener('click', () => {
      game?.destroy(true);
      game = null;
      history.pushState(null, '', '/');
      showTitle(startSetup);
    });
    if (import.meta.env.VITE_TEST_HOOKS === '1') {
      window.__db = { getState: () => controller.state };
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
  if (state.phase.kind === 'gameOver') {
    renderResults(app, state, startSetup, () => showTitle(startSetup));
    return;
  }
  game?.destroy(true);
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;
  const controller = new GameController({
    state,
    speed: testHooks.speed,
    onEvents: async (events, nextState) => {
      renderHud(app, nextState, dispatch);
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
            if (!game?.scene.isActive('BattleScene')) scene?.scene.launch('BattleScene');
          } else if (game?.scene.isActive('BattleScene')) {
            scene?.scene.stop('BattleScene');
          }
        },
      );
      if (nextState.phase.kind === 'gameOver') {
        game?.destroy(true);
        game = null;
        renderResults(app, nextState, startSetup, () => {
          showTitle(startSetup);
        });
      }
    },
  });
  function dispatch(action: Action): void {
    if (action.type === 'pvpReward') {
      void controller.dispatch(action);
      return;
    }
    void controller.dispatch(action);
  }
  renderHud(app, controller.state, dispatch);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'phaser-board',
    width: 640,
    height: 360,
    backgroundColor: '#273449',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, BoardScene, BattleScene],
  });
  game.registry.set('state', state);
  app.querySelector('[data-action="exit"]')?.addEventListener('click', () => {
    game?.destroy(true);
    game = null;
    showTitle(startSetup);
  });
  if (import.meta.env.VITE_TEST_HOOKS === '1') {
    window.__db = { getState: () => controller.state };
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
    __db?: { getState: () => GameState };
    diceBanditsText: (key: string) => string;
    diceBanditsSpeed: number;
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
