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
import { createDiceRoll, readRollResult } from './ui/diceRoll';
import { createBattleReadout } from './ui/battleUi';
import { planBattle } from './scenes/battle/presentation';
import { reducedMotion } from './art/motion';

const app = getMount();
initAudio();
let game: Phaser.Game | null = null;
let diceyGuide: ReturnType<typeof createDiceyGuide> | undefined;
let battleReadout: ReturnType<typeof createBattleReadout> | undefined;
let diceRoll: ReturnType<typeof createDiceRoll> | undefined;
let sessionGeneration = 0;
let unbindGameLanguage: (() => void) | undefined;

/** Phaser destroy is deferred; remove body-owned board UI synchronously. */
function destroyGame(): void {
  sessionGeneration++;
  unbindGameLanguage?.();
  unbindGameLanguage = undefined;
  (game?.scene.getScene('BattleScene') as BattleScene | undefined)?.cancelBattlePresentation?.();
  battleReadout?.destroy();
  battleReadout = undefined;
  diceRoll?.destroy();
  diceRoll = undefined;
  diceyGuide?.destroy();
  diceyGuide = undefined;
  closeSpaceInfo();
  clearForkArrows();
  (game?.scene.getScene('BoardScene') as BoardScene | undefined)?.cancelOnlineMovement?.();
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
  const generation = sessionGeneration;
  const isCurrent = (): boolean => generation === sessionGeneration;
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;
  const guide = createDiceyGuide(app);
  diceyGuide = guide;
  const rollView = createDiceRoll(app);
  diceRoll = rollView;
  const readout = createBattleReadout(app);
  battleReadout = readout;
  let displayedState = firstView.state;
  let presentationBusy = false;
  let previousTipState = firstView.state;
  let tipEvents: GameEvent[] = [];
  let tipsReady = false;
  let movementGeneration = 0;
  // OnlineController serializes one onEvents callback per received view. Keep
  // receipt ownership in the same FIFO; queued work must never renew it.
  const receivedMovementGenerations: number[] = [];
  const cancelMovement = (): void => {
    movementGeneration++;
    (game?.scene.getScene('BattleScene') as BattleScene | undefined)?.cancelBattlePresentation?.();
    readout.reset(controller.state);
    (game?.scene.getScene('BoardScene') as BoardScene | undefined)?.cancelOnlineMovement?.();
  };

  const dispatch = (action: Action): void => {
    if (!isCurrent() || presentationBusy) return;
    cancelMovement();
    void controller.dispatch(action);
  };
  const renderOnlineHud = (): void => {
    if (!isCurrent()) return;
    if (!presentationBusy) displayedState = controller.state;
    renderHud(app, displayedState, dispatch, {
      legal: controller.legal,
      online: controller.hudOnlineState,
      presentationBusy,
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
    if (!isCurrent()) return;
    destroyGame();
    app.innerHTML = `<main class="screen online-screen" data-testid="screen-online-error"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button></header><p class="error" role="alert" data-testid="online-error">${escapeHtml(t(key))}</p></main>`;
    app.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', () => {
      history.pushState(null, '', '/');
      showTitle(startSetup);
    });
  };
  const showOnlineResults = (state: GameState): void => {
    if (!isCurrent()) return;
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
      const presentationGeneration = receivedMovementGenerations.shift();
      if (!isCurrent()) return;
      const previous = controller.state;
      presentationBusy = true;
      guide.dismiss();
      tipEvents.push(...events);
      onGameEvents(events, nextState);
      renderOnlineHud();
      const ownedGame = game;
      const scene = ownedGame?.scene.getScene('BoardScene') as BoardScene | undefined;
      const battleScene = ownedGame?.scene.getScene('BattleScene') as BattleScene | undefined;
      await animateThenRender(
        async () => {
          for (const event of events) {
            const result = readRollResult(event);
            if (result) {
              // A static badge updates synchronously; no timer or view backlog.
              void rollView.play(result, {
                speed: testHooks.speed,
                reduced: reducedMotion(),
                waitBeforeMovement: false,
              });
            }
          }
          if (!isCurrent()) return;
          // All online battle cosmetics run after commit, never in this await.
        },
        () => {
          if (!isCurrent()) return;
          presentationBusy = false;
          renderEventToast(app, events);
          ownedGame?.registry.set('state', nextState);
          ownedGame?.events.emit('game-state', nextState);
          if (nextState.phase.kind === 'battle') {
            if (ownedGame?.scene.isActive('BoardScene') && !ownedGame.scene.isActive('BattleScene'))
              scene?.scene.launch('BattleScene');
          } else if (ownedGame?.scene.isActive('BattleScene')) {
            scene?.scene.stop('BattleScene');
          }
          if (presentationGeneration === movementGeneration) {
            scene?.presentOnlineMovement?.(previous, nextState, events, presentationGeneration);
            readout.reset(previous);
            if (nextState.phase.kind === 'battle' && ownedGame?.scene.isActive('BattleScene')) {
              void battleScene
                ?.playEvents(events, testHooks.speed, {
                  previous,
                  next: nextState,
                  mode: 'online',
                  onBeat: (beat) => readout.showBeat(beat),
                  onCancel: () => readout.reset(nextState),
                })
                .then(() => {
                  if (
                    isCurrent() &&
                    presentationGeneration === movementGeneration &&
                    testHooks.speed > 0 &&
                    !reducedMotion()
                  )
                    readout.reset(nextState);
                });
            } else {
              for (const beat of planBattle(previous, nextState, events, 'online', true))
                readout.showBeat(beat);
            }
          }
          // OnlineController commits its new legal/view immediately after this
          // promise settles; only that handoff mounts the actionable next HUD.
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
    if (!isCurrent()) return;
    if (message.type === 'view' || message.type === 'events') cancelMovement();
    if (message.type === 'view') receivedMovementGenerations.push(movementGeneration);
    if (message.type === 'error') {
      if (message.key === 'online.error.notFound') {
        clearSession(session.code);
        showOnlineError(message.key);
      } else showOnlineNotice(message.key);
      return;
    }
    void controller.handleMessage(message).then(() => {
      if (!isCurrent() || message.type !== 'view') return;
      if (controller.state.phase.kind === 'gameOver') showOnlineResults(controller.state);
      else renderOnlineHud();
    });
  };
  const handleStatus = (status: RoomSocketStatus): void => {
    if (!isCurrent()) return;
    cancelMovement();
    controller.setSocketStatus(status);
    if (app.querySelector('[data-testid="screen-board"]')) renderOnlineHud();
  };
  socket.setHandlers({
    onMessage: handleMessage,
    onStatus: handleStatus,
    onTerminal: (code) => {
      if (!isCurrent()) return;
      if (code === 4404) clearSession(session.code);
      showOnlineError(code === 4404 ? 'online.error.notFound' : 'online.error.openedElsewhere');
    },
  });

  receivedMovementGenerations.push(movementGeneration);
  void controller.handleMessage(firstView).then(() => {
    if (!isCurrent()) return;
    if (controller.state.phase.kind === 'gameOver') {
      showOnlineResults(controller.state);
      return;
    }
    setMusic(musicForState(controller.state));
    tipsReady = true;
    renderOnlineHud();
    game = createPhaserGame('phaser-board');
    // Fork arrows (canvas) dispatch through the same controller as the DOM tray.
    game.events.on('board-chooseBranch', (to: number) => dispatch({ type: 'chooseBranch', to }));
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
    unbindGameLanguage = () => window.removeEventListener('dice-bandits:lang', renderOnlineHud);
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
  const generation = sessionGeneration;
  const isCurrent = (): boolean => generation === sessionGeneration;
  setMusic(musicForState(state));
  window.diceBanditsText = t;
  window.diceBanditsSpeed = testHooks.speed;
  const guide = createDiceyGuide(app);
  diceyGuide = guide;
  const rollView = createDiceRoll(app);
  diceRoll = rollView;
  const readout = createBattleReadout(app);
  battleReadout = readout;
  let displayedState = state;
  let presentationBusy = false;
  const isLocalHuman = (seat: number): boolean => displayedState.players[seat]?.control === 'human';
  const renderLocalHud = (): void => {
    if (isCurrent()) renderHud(app, displayedState, dispatch, { presentationBusy });
  };
  const controller = new GameController({
    state,
    speed: testHooks.speed,
    onEvents: async (events, nextState) => {
      if (!isCurrent()) return;
      presentationBusy = true;
      guide.dismiss();
      renderLocalHud();
      readout.reset(displayedState);
      onGameEvents(events, nextState);
      const ownedGame = game;
      const scene = ownedGame?.scene.getScene('BoardScene') as BoardScene | undefined;
      const battleScene = ownedGame?.scene.getScene('BattleScene') as BattleScene | undefined;
      await animateThenRender(
        async () => {
          for (const event of events) {
            const result = readRollResult(event);
            if (!result) continue;
            await rollView.play(result, {
              speed: testHooks.speed,
              reduced: reducedMotion(),
              waitBeforeMovement: result.seat !== null && isLocalHuman(result.seat),
            });
            if (!isCurrent()) return;
          }
          if (!isCurrent()) return;
          await Promise.all([
            scene?.playEvents(events) ?? Promise.resolve(),
            ownedGame?.scene.isActive('BattleScene')
              ? (battleScene?.playEvents(events, testHooks.speed, {
                  previous: displayedState,
                  next: nextState,
                  mode:
                    displayedState.phase.kind === 'battle' &&
                    (['a', 'b'] as const).some((side) => {
                      if (displayedState.phase.kind !== 'battle') return false;
                      const seat = displayedState.phase.battle[side].seat;
                      return seat !== null && displayedState.players[seat]?.control === 'human';
                    })
                      ? 'human'
                      : 'bot',
                  onBeat: (beat) => readout.showBeat(beat),
                  onCancel: () => readout.reset(nextState),
                }) ?? Promise.resolve())
              : Promise.resolve(),
          ]);
        },
        () => {
          // destroyGame settles play; its continuation must not touch a new game.
          if (!isCurrent()) return;
          const previous = displayedState;
          displayedState = nextState;
          // Static results remain legible until the next real action. Animated
          // completion releases held HP before mounting the next legal tray.
          if (testHooks.speed > 0 && !reducedMotion()) readout.reset(nextState);
          presentationBusy = false;
          renderLocalHud();
          guide.update({ prev: previous, next: nextState, events, isLocalHuman });
          renderEventToast(app, events);
          ownedGame?.registry.set('state', nextState);
          ownedGame?.events.emit('game-state', nextState);
          if (nextState.phase.kind === 'battle') {
            // BootScene handles battle entry when atlases are still loading.
            if (ownedGame?.scene.isActive('BoardScene') && !ownedGame.scene.isActive('BattleScene'))
              scene?.scene.launch('BattleScene');
          } else if (ownedGame?.scene.isActive('BattleScene')) {
            scene?.scene.stop('BattleScene');
          }
        },
      );
      if (!isCurrent()) return;
      if (nextState.phase.kind === 'gameOver') {
        destroyGame();
        setMusic('board');
        renderResults(app, nextState, startSetup, () => showTitle(startSetup));
      }
    },
  });
  function dispatch(action: Action): void {
    if (!isCurrent() || presentationBusy) return;
    void controller.dispatch(action);
  }
  // The HUD mounts `#phaser-board`; Phaser must be created after it exists.
  renderLocalHud();
  guide.update({ prev: state, next: state, events: [], isLocalHuman });
  game = createPhaserGame('phaser-board');
  game.events.on('board-chooseBranch', (to: number) => dispatch({ type: 'chooseBranch', to }));
  game.registry.set('state', state);
  window.diceBanditsMapWhole = false;
  game.registry.set('onBoardOutdated', (): void => {
    if (!isCurrent()) return;
    destroyGame();
    showOnlineErrorScreen('error.boardOutdated');
  });
  bindMapToggle(app, game, () => displayedState);
  if (import.meta.env.VITE_TEST_HOOKS === '1') {
    window.__db = {
      getState: () => controller.state,
      art: createArtProbe(),
    };
  }
  window.addEventListener('dice-bandits:lang', renderLocalHud);
  unbindGameLanguage = () => window.removeEventListener('dice-bandits:lang', renderLocalHud);
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
