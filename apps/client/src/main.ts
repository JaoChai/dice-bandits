import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/press-start-2p/400.css';
import './ui/styles.css';
import { createGame } from '@dice-bandits/engine';
import { showSetup, showTitle } from './ui/screens';
import { clearSave, saveGame } from './save';
import { testHooks } from './testHooks';
import { t } from './i18n';

const app = getMount();

function getMount(): HTMLElement {
  const mount = document.querySelector<HTMLElement>('#app');
  if (!mount) throw new Error('Missing #app mount element');
  return mount;
}

function startSetup(): void {
  showSetup((config) => {
    const state = createGame(config);
    saveGame(state);
    renderStarted(state.config.seats[0]?.name ?? '');
  });
}

function renderStarted(playerName: string): void {
  app.innerHTML = `<main class="screen title-screen" data-testid="screen-game-ready"><h1 class="pixel">DICE BANDITS</h1><p>${playerName.replace(/[&<>"']/g, '')}</p><button class="secondary" data-action="exit">${t('setup.back')}</button></main>`;
  app.querySelector('[data-action="exit"]')?.addEventListener('click', () => {
    clearSave();
    showTitle(startSetup);
  });
}

app.addEventListener('dice-bandits:continue', (event) => {
  const state = (event as CustomEvent<{ config?: { seats?: { name: string }[] } }>).detail;
  renderStarted(state?.config?.seats?.[0]?.name ?? '');
});

const hooks = testHooks;
if (hooks.enabled && hooks.seed)
  history.replaceState(null, '', `?seed=${encodeURIComponent(hooks.seed)}&speed=${hooks.speed}`);
showTitle(startSetup);
