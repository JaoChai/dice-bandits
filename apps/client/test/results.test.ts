import { createGame } from '@dice-bandits/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../src/i18n';
import { renderResults } from '../src/ui/results';

const makeGame = () =>
  createGame({
    seed: 'results-test',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
});

describe('results screen', () => {
  it('renders the hot town region and a localized none label', () => {
    const state = makeGame();
    const town = state.towns[0]!;
    state.phase = {
      kind: 'gameOver',
      ranking: [0, 1],
      winners: [0],
      highlights: [
        { key: 'hotTown', spaceId: town.spaceId, flips: 2 },
        { key: 'hotTown', spaceId: null, flips: 0 },
      ],
    };
    document.body.innerHTML = '<div id="app"></div>';
    setLang('en');
    renderResults(
      document.querySelector<HTMLElement>('#app')!,
      state,
      () => {},
      () => {},
    );

    const text = document.querySelector('[data-testid="results"]')!.textContent!;
    const region = state.board.spaces.find((space) => space.id === town.spaceId)!.region;
    expect(text).toContain(
      t('results.townName', { region: t(`region.${region}`), id: town.spaceId }),
    );
    expect(text).not.toMatch(/Hot town:\s*\d/);
    expect(text).toContain(t('results.noTown'));
  });
});
