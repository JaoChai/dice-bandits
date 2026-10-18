import { data, type GameState, type Highlight, type Player } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { portraitStyle } from './artFrames';

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

const CROWN_SVG =
  '<svg class="results-crown" viewBox="0 0 54 40" aria-hidden="true"><path d="M4 34 L8 10 L19 22 L27 4 L35 22 L46 10 L50 34 Z" fill="#ffb81c" stroke="#3b2414" stroke-width="3" stroke-linejoin="round"/><circle cx="27" cy="5" r="3" fill="#e2412e" stroke="#3b2414" stroke-width="2"/></svg>';

const BAG_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 7 C9 4 11 3 12 3 C13 3 15 4 15 7 L18 9 L17 20 Q12 22 7 20 L6 9 Z" fill="#ffb81c" stroke="#3b2414" stroke-width="2" stroke-linejoin="round"/></svg>';

const FIST_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 11 L9 6 L12 9 L15 6 L19 11 L17 18 Q12 20 7 18 Z" fill="#e2412e" stroke="#3b2414" stroke-width="2" stroke-linejoin="round"/></svg>';

const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M12 2 L15 9 L22 9.5 L16.5 14 L18.5 21 L12 17 L5.5 21 L7.5 14 L2 9.5 L9 9 Z" fill="{color}" stroke="#3b2414" stroke-width="1.5" stroke-linejoin="round"/></svg>';

const STAR_SPOTS: Array<[number, number, string]> = [
  [8, 12, '#ffb81c'],
  [88, 8, '#7fd1ff'],
  [14, 70, '#ff8ab3'],
  [92, 64, '#ffb81c'],
  [50, 4, '#ff8ab3'],
];

export function renderResults(
  root: HTMLElement,
  state: GameState,
  onPlayAgain: () => void,
  onTitle: () => void,
): void {
  const model = buildResultsModel(state);
  if (!model.rows.length) return;
  const tied = model.rows.filter((row) => row.winner);
  const heroIndex = model.rows.findIndex((row) => row.winner);
  const heroRow = model.rows[heroIndex]!;

  const portrait = (player: Player, extraClass = ''): string =>
    `<span class="results-portrait${extraClass ? ` ${extraClass}` : ''}" style="${portraitStyle(player.classId)}" aria-hidden="true"></span>`;

  const heroInner =
    tied.length > 1
      ? `<h1 class="results-winner-name">${t('results.tieTitle')}</h1><div class="results-tie-row">${tied
          .map((row) => {
            const player = state.players[row.seat]!;
            return `<span class="results-tie">${portrait(player)}<span class="results-tie-name">${escapeHtml(row.name)}</span></span>`;
          })
          .join('')}</div>`
      : `${portrait(state.players[heroRow.seat]!, 'results-portrait-hero')}<h1 class="results-winner-name">${t('results.winTitle', { name: escapeHtml(heroRow.name) })}</h1><span class="results-winner-label">${t('results.netWorthLabel')}</span><span class="results-winner-value">${t('results.netWorth', { value: heroRow.netWorth })}</span>`;

  const heroLi = `<li class="results-winner winner">${CROWN_SVG}<span class="results-medal results-medal-gold" aria-hidden="true">1</span>${heroInner}</li>`;

  const lis = model.rows
    .map((row, index) => {
      if (index === heroIndex) return heroLi;
      const player = state.players[row.seat]!;
      const medal = row.winner ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'plain';
      return `<li class="results-rank${row.winner ? ' winner' : ''}"><span class="results-medal results-medal-${medal}" aria-hidden="true">${row.winner ? 1 : index + 1}</span>${portrait(player)}<span class="results-rank-name">${escapeHtml(row.name)}</span><span class="results-rank-value">${t('results.netWorth', { value: row.netWorth })}</span></li>`;
    })
    .join('');

  const honours = model.highlights.flatMap((highlight) => {
    if (highlight.key === 'hotTown') {
      if (highlight.spaceId === null || highlight.flips === 0) return [];
      const space = state.board.spaces.find((item) => item.id === highlight.spaceId);
      if (!space) return [];
      const town = t('results.townName', {
        region: t(`region.${space.region}`),
        id: highlight.spaceId,
      });
      return [t('results.badgeHotTown', { town, flips: highlight.flips })];
    }
    if (highlight.value === 0) return [];
    const player = state.players[highlight.seat];
    if (!player) return [];
    const name = escapeHtml(player.prank?.alias ?? player.name);
    const icon = highlight.key === 'biggestRobbery' ? BAG_SVG : FIST_SVG;
    const key = highlight.key === 'biggestRobbery' ? 'results.badgeRobber' : 'results.badgeKo';
    return [
      `${icon}<span class="results-honour-text">${t(key, { name, value: highlight.value })}</span>`,
    ];
  });

  root.innerHTML = `<main class="results-screen card" data-testid="results"><div class="results-backdrop" aria-hidden="true">${STAR_SPOTS.map(
    ([left, top, color]) =>
      `<span class="results-star" style="left:${left}%;top:${top}%">${STAR_SVG.replace('{color}', color)}</span>`,
  ).join(
    '',
  )}</div><div class="results-layout"><nav class="results-langs" aria-label="${t('title.language')}"><button type="button" data-lang="th" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></nav><div class="results-panel" aria-hidden="true"></div><ol class="results-ranking">${lis}</ol><p class="results-scoreline">${t('results.scoreLine')}</p>${
    honours.length
      ? `<section class="results-honours" aria-label="${t('results.highlights')}">${honours
          .map((honour) => `<span class="results-honour">${honour}</span>`)
          .join('')}</section>`
      : ''
  }<div class="results-actions"><button class="primary" data-testid="play-again">${t('results.playAgain')}</button><button class="secondary" data-testid="results-title">${t('results.titleButton')}</button></div></div></main>`;

  root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => {
      setLang(button.dataset.lang as 'th' | 'en');
      renderResults(root, state, onPlayAgain, onTitle);
      // The re-render replaces every node; put focus back on the pressed pill
      // so keyboard users do not lose their place mid toggle.
      root.querySelector<HTMLButtonElement>(`[data-lang="${button.dataset.lang}"]`)?.focus();
    });
  });
  root.querySelector('[data-testid="play-again"]')?.addEventListener('click', onPlayAgain);
  root.querySelector('[data-testid="results-title"]')?.addEventListener('click', onTitle);
}

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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
