import type { GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { portraitStyle } from './artFrames';

/** View-only player information; the caller owns online takeover/reclaim data. */
export function showSeatDetails(
  root: HTMLElement,
  state: GameState,
  seat: number,
  onClose: () => void,
): () => void {
  const player = state.players.find((player) => player.seat === seat);
  if (!player) return () => undefined;
  const shade = document.createElement('div');
  shade.className = 'seat-detail-shade';
  const panel = document.createElement('section');
  panel.className = 'seat-detail-panel card';
  panel.dataset.testid = 'seat-detail-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', player.prank?.alias ?? player.name);
  const add = (tag: string, text: string, className = ''): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    panel.append(node);
    return node;
  };
  const portrait = add('div', '', `seat-portrait portrait-${player.classId}`);
  portrait.setAttribute('style', portraitStyle(player.classId));
  portrait.setAttribute('role', 'img');
  portrait.setAttribute('aria-label', t(`class.${player.classId}`));
  add('h2', player.prank?.alias ?? player.name);
  add(
    'p',
    `${t(`class.${player.classId}`)} · ${t(player.control === 'human' ? 'setup.human' : 'setup.bot')}`,
  );
  const gold = add('p', `${player.gold} ${t('board.gold')}`, 'gold-pill');
  gold.setAttribute('aria-label', gold.textContent!);
  add('p', `${t('board.level')} ${player.level}`);
  add('p', `${state.towns.filter((town) => town.owner === seat).length} ${t('board.towns')}`);
  const health = add('div', '', 'seat-health');
  health.setAttribute('role', 'meter');
  health.setAttribute('aria-label', t('board.hp'));
  health.setAttribute('aria-valuemin', '0');
  health.setAttribute('aria-valuemax', String(player.stats.maxHp));
  health.setAttribute('aria-valuenow', String(player.hp));
  health.innerHTML =
    '<svg class="hp-heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21 3 12C-3 6 5-2 12 5c7-7 15 1 9 7Z"/></svg><div class="hp-track"><span></span></div>';
  health.querySelector<HTMLElement>('.hp-track span')!.style.width =
    `${Math.max(0, Math.min(100, (player.hp / player.stats.maxHp) * 100))}%`;
  add('p', `${t('board.hp')} ${player.hp}/${player.stats.maxHp}`);
  const cards = player.banditCards.map((card) => t(`card.${card}`)).join(' · ');
  const count = add('p', `${player.banditCards.length} 🃏`, 'seat-status');
  count.dataset.testid = `seat-cards-${seat}`;
  count.title = cards;
  if (cards) count.setAttribute('aria-label', cards);
  if (cards) add('p', cards);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'primary';
  close.dataset.testid = 'seat-detail-close';
  close.textContent = t('common.close');
  panel.append(close);
  shade.append(panel);
  const siblings = [...root.children].map((node) => ({
    node: node as HTMLElement,
    inert: (node as HTMLElement).inert,
  }));
  siblings.forEach(({ node }) => {
    node.inert = true;
  });
  root.append(shade);
  let closed = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    shade.remove();
    siblings.forEach(({ node, inert }) => {
      node.inert = inert;
    });
    onClose();
  };
  close.addEventListener('click', dispose);
  shade.addEventListener('click', (event) => {
    if (event.target === shade) dispose();
  });
  shade.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      dispose();
    } else if (event.key === 'Tab') {
      const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey ? current - 1 : current + 1;
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
  });
  close.focus();
  return dispose;
}
