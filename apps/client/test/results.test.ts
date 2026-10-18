import { createGame, type GameState, type Highlight } from '@dice-bandits/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../src/i18n';
import { buildResultsModel, renderResults } from '../src/ui/results';

const makeGame = () =>
  createGame({
    seed: 'results-test',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });

const gameOverPhase = (highlights: Highlight[] = [], winners = [0], ranking = [0, 1]) => ({
  kind: 'gameOver' as const,
  ranking,
  winners,
  highlights,
});

let playAgainCalls = 0;
let titleCalls = 0;

const mount = () => {
  document.body.innerHTML = '<div id="app"></div>';
  return document.querySelector<HTMLElement>('#app')!;
};

const render = (state: GameState) =>
  renderResults(
    mount(),
    state,
    () => {
      playAgainCalls += 1;
    },
    () => {
      titleCalls += 1;
    },
  );

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
  playAgainCalls = 0;
  titleCalls = 0;
});

describe('results screen', () => {
  it('shows the hot town honour with its localized region and hides the zero-flip one', () => {
    const state = makeGame();
    const town = state.towns[0]!;
    state.phase = gameOverPhase([
      { key: 'hotTown', spaceId: town.spaceId, flips: 2 },
      { key: 'hotTown', spaceId: null, flips: 0 },
    ]);
    setLang('en');
    render(state);

    const text = document.querySelector('[data-testid="results"]')!.textContent!;
    const region = state.board.spaces.find((space) => space.id === town.spaceId)!.region;
    expect(text).toContain(
      t('results.townName', { region: t(`region.${region}`), id: town.spaceId }),
    );
    expect(text).not.toMatch(/Hot town:\s*\d/);
    // Migrated from results.test.ts:49 (`toContain(t('results.noTown'))`): the
    // zero-flip honour is now hidden entirely instead of printing a "None" row.
    expect(text).not.toContain('0 flips');
  });

  it('renders every portrait from its own player class', () => {
    const state = makeGame();
    state.phase = gameOverPhase();
    setLang('en');
    render(state);

    const portraits = [...document.querySelectorAll<HTMLElement>('.results-portrait')];
    expect(portraits).toHaveLength(2);
    expect(portraits[0]!.getAttribute('style')).toContain('hero-knight');
    expect(portraits[1]!.getAttribute('style')).toContain('hero-thief');
  });

  it('shows the rank-1 name, label and value in the winner card', () => {
    const state = makeGame();
    state.phase = gameOverPhase();
    setLang('en');
    render(state);

    const card = document.querySelector('.results-winner')!;
    const model = buildResultsModel(state);
    expect(card.textContent).toContain(model.rows[0]!.name);
    expect(card.querySelector('.results-winner-value')!.textContent).toContain(
      `${model.rows[0]!.netWorth} G`,
    );
    expect(card.textContent).toContain(t('results.netWorthLabel'));
  });

  it('shows the tie heading with every tied winner in the card', () => {
    const state = makeGame();
    state.phase = gameOverPhase([], [0, 1]);
    setLang('en');
    render(state);

    const card = document.querySelector('.results-winner')!;
    expect(card.textContent).toContain(t('results.tieTitle'));
    expect(card.querySelectorAll('.results-portrait')).toHaveLength(2);
    expect(card.textContent).toContain('A');
    expect(card.textContent).toContain('B');
    expect(document.querySelectorAll('.results-ranking li')).toHaveLength(2);
    expect(document.querySelectorAll('.results-ranking li.winner')).toHaveLength(2);
  });

  it('hides zero-value honours and the whole section when all are hidden', () => {
    const state = makeGame();
    state.phase = gameOverPhase([
      { key: 'hotTown', spaceId: null, flips: 0 },
      { key: 'biggestRobbery', seat: 1, value: 0 },
    ]);
    setLang('en');
    render(state);
    expect(document.querySelector('.results-honours')).toBeNull();

    state.phase = gameOverPhase([
      { key: 'biggestRobbery', seat: 1, value: 120 },
      { key: 'mostKod', seat: 0, value: 0 },
    ]);
    render(state);
    const text = document.querySelector('.results-honours')!.textContent!;
    expect(text).toContain(t('results.badgeRobber', { name: 'B', value: 120 }));
    expect(text).not.toContain('0 KOs');
  });

  it('shows the net-worth score line in both languages', () => {
    const state = makeGame();
    state.phase = gameOverPhase();

    setLang('en');
    render(state);
    expect(document.querySelector('[data-testid="results"]')!.textContent).toContain(
      t('results.scoreLine'),
    );

    setLang('th');
    render(state);
    expect(document.querySelector('[data-testid="results"]')!.textContent).toContain(
      t('results.scoreLine'),
    );
  });

  it('wires the play-again and title buttons', () => {
    const state = makeGame();
    state.phase = gameOverPhase();
    setLang('en');
    render(state);

    (document.querySelector('[data-testid="play-again"]') as HTMLButtonElement).click();
    (document.querySelector('[data-testid="results-title"]') as HTMLButtonElement).click();
    expect(playAgainCalls).toBe(1);
    expect(titleCalls).toBe(1);
  });

  it('keeps focus on the pressed language button after re-render', () => {
    const state = makeGame();
    state.phase = gameOverPhase();
    setLang('th');
    render(state);

    (document.querySelector('[data-lang="en"]') as HTMLButtonElement).click();
    expect(document.activeElement?.getAttribute('data-lang')).toBe('en');
    expect(document.querySelector('[data-lang="en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-testid="results"]')!.textContent).toContain('wins!');
  });

  it('keeps one ranking li per player in ranking order', () => {
    const state = makeGame();
    state.phase = gameOverPhase([], [1], [1, 0]);
    setLang('en');
    render(state);

    const lis = [...document.querySelectorAll<HTMLElement>('.results-ranking li')];
    expect(lis).toHaveLength(2);
    expect(lis[0]!.classList.contains('winner')).toBe(true);
    expect(lis[0]!.textContent).toContain('B');
    expect(lis[1]!.classList.contains('winner')).toBe(false);
    expect(lis[1]!.textContent).toContain('A');
  });
});
