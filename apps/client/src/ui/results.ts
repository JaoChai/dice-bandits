import { data, type GameState, type Highlight, type Player } from '@dice-bandits/engine';

export interface ResultsRow {
  seat: number;
  name: string;
  netWorth: number;
  winner: boolean;
}

export interface ResultsModel {
  rows: ResultsRow[];
  highlights: Highlight[];
}

export function buildResultsModel(state: GameState): ResultsModel {
  if (state.phase.kind !== 'gameOver') return { rows: [], highlights: [] };
  const winners = new Set(state.phase.winners);
  return {
    rows: state.phase.ranking.map((seat) => {
      const player = state.players[seat]!;
      return {
        seat,
        name: player.prank?.alias ?? player.name,
        netWorth: netWorth(state, player),
        winner: winners.has(seat),
      };
    }),
    highlights: state.phase.highlights,
  };
}

export function renderResults(
  root: HTMLElement,
  state: GameState,
  onPlayAgain: () => void,
  onTitle: () => void,
): void {
  const model = buildResultsModel(state);
  root.innerHTML = `<main class="results-screen" data-testid="results"><header class="results-header"><h1 class="pixel">${t('results.title')}</h1><nav aria-label="${t('title.language')}"><button type="button" data-lang="th" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></nav></header><ol class="results-ranking">${model.rows.map((row, index) => `<li class="${row.winner ? 'winner' : ''}"><span>${index + 1}. ${escapeHtml(row.name)}</span><span>${t('results.netWorth', { value: row.netWorth })}</span></li>`).join('')}</ol><section class="results-highlights"><h2>${t('results.highlights')}</h2>${model.highlights.map((highlight) => `<p>${highlightLabel(highlight, state)}</p>`).join('')}</section><div class="results-actions"><button class="primary" data-testid="play-again">${t('results.playAgain')}</button><button class="secondary" data-testid="results-title">${t('results.titleButton')}</button></div></main>`;
  root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => {
      setLang(button.dataset.lang as 'th' | 'en');
      renderResults(root, state, onPlayAgain, onTitle);
    });
  });
  root.querySelector('[data-testid="play-again"]')?.addEventListener('click', onPlayAgain);
  root.querySelector('[data-testid="results-title"]')?.addEventListener('click', onTitle);
}

import { getLang, setLang, t } from '../i18n';

function netWorth(state: GameState, player: Player): number {
  const inventoryValue = player.items.reduce(
    (sum, id) => sum + Math.floor((data.ITEM_BY_ID[id]?.price ?? 0) * data.BALANCE.resaleRatio),
    0,
  );
  return (
    player.gold +
    inventoryValue +
    state.towns
      .filter((town) => town.owner === player.seat)
      .reduce((sum, town) => sum + town.value, 0)
  );
}

function highlightLabel(highlight: Highlight, state: GameState): string {
  if (highlight.key === 'hotTown') {
    const space =
      highlight.spaceId === null || highlight.flips === 0
        ? undefined
        : state.board.spaces.find((item) => item.id === highlight.spaceId);
    const town =
      highlight.spaceId === null || highlight.flips === 0 || !space
        ? t('results.noTown')
        : t('results.townName', {
            region: t(`region.${space.region}`),
            id: highlight.spaceId,
          });
    const townValue =
      highlight.spaceId === null || highlight.flips === 0
        ? 0
        : (state.towns.find((item) => item.spaceId === highlight.spaceId)?.value ?? 0);
    return t('results.hotTown', {
      town,
      flips: highlight.flips,
      value: townValue,
    });
  }
  return t(`results.${highlight.key}`, {
    name: escapeHtml(state.players[highlight.seat]?.name ?? ''),
    value: highlight.value,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
