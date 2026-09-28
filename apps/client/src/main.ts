import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/press-start-2p/400.css';
import './ui/styles.css';
import Phaser from 'phaser';
import { createGame, type Action, type GameState } from '@dice-bandits/engine';
import { GameController } from './controller';
import { showSetup, showTitle } from './ui/screens';
import { clearSave, saveGame } from './save';
import { testHooks } from './testHooks';
import { t } from './i18n';
import BootScene from './scenes/BootScene';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';
import { animateThenRender } from './eventOrder';
import { renderHud } from './ui/hud';
import { renderEventToast } from './ui/dialogs';
import { renderResults } from './ui/results';

const app = getMount();
let game: Phaser.Game | null = null;

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
  if (testHooks.enabled) {
    window.__db = { getState: () => controller.state };
  } else {
    delete window.__db;
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
showTitle(startSetup);
