import { data } from '@dice-bandits/engine';
import type { PostResult } from './battlePostModel';
import { postText } from './battlePostModel';
import { iconStyle } from './artFrames';

/** Cosmetic interpolation; cumulative engine XP is never rewritten. */
export function animatePostRewards(root: HTMLElement, result: PostResult, duration: number) {
  const up = result.level > result.fromLevel;
  const fill = (xp: number, min: number, max: number) =>
    Math.min(1, Math.max(0, (xp - min) / Math.max(1, max - min)));
  const oldMin = data.BALANCE.xpToLevel[result.fromLevel - 1] ?? 0;
  const progressAt = (xp: number, min: number, max: number) =>
    Math.min(Math.max(1, max - min), Math.max(0, Math.round(xp - min)));
  const oldGoal = Math.max(1, result.xpGoal - oldMin);
  root.innerHTML = `<div class="post-gold" data-testid="post-gold"><span class="post-icon" style="${iconStyle('coin')}" aria-hidden="true"></span><strong>+${result.gold}</strong><span>${postText('gold')} · <b data-testid="post-gold-total">${result.fromGold}</b></span></div><div class="post-xp" data-xp-stage="fill"><span>+${result.xp} ${postText('xp')}</span><div class="post-xp-track" ${result.fromLevel >= data.BALANCE.levelCap ? 'hidden' : ''} role="progressbar" aria-label="${postText('xp')}" aria-valuemin="0" aria-valuemax="${oldGoal}" aria-valuenow="${progressAt(result.fromXp, oldMin, result.xpGoal)}"><span style="transform:scaleX(${fill(result.fromXp, oldMin, result.xpGoal)})"></span></div><span class="post-xp-amount">${result.fromLevel >= data.BALANCE.levelCap ? `Lv. ${result.fromLevel}` : `${progressAt(result.fromXp, oldMin, result.xpGoal)} / ${oldGoal} XP · Lv. ${result.fromLevel}`}</span>${up ? '<b class="post-level-badge">LV UP</b>' : ''}</div>`;
  const gold = root.querySelector<HTMLElement>('[data-testid="post-gold-total"]')!;
  const xp = root.querySelector<HTMLElement>('.post-xp')!;
  const track = root.querySelector<HTMLElement>('.post-xp-track')!;
  const bar = track.querySelector<HTMLElement>('span')!;
  const label = root.querySelector<HTMLElement>('.post-xp-amount')!;
  const start = performance.now();
  let timer: number | undefined;
  const update = (progress: number) => {
    gold.textContent = String(
      Math.round(result.fromGold + (result.toGold - result.fromGold) * progress),
    );
    const reset = up && progress >= 0.62;
    const current = reset
      ? result.xpGoal + (result.toXp - result.xpGoal) * ((progress - 0.62) / 0.38)
      : result.fromXp +
        (Math.min(result.toXp, result.xpGoal) - result.fromXp) *
          Math.min(1, progress / (up ? 0.45 : 1));
    xp.dataset.xpStage = reset ? 'remaining' : up && progress >= 0.45 ? 'flash' : 'fill';
    xp.classList.toggle('has-level-up', up && progress >= 0.45);
    const goal = reset ? result.nextXpGoal : result.xpGoal;
    const min = reset ? (data.BALANCE.xpToLevel[result.level - 1] ?? result.xpGoal) : oldMin;
    const capacity = Math.max(1, goal - min);
    const value = progressAt(current, min, goal);
    bar.style.transitionDuration = '0ms';
    bar.style.transform = `scaleX(${fill(current, min, goal)})`;
    track.setAttribute('aria-valuemax', String(capacity));
    track.setAttribute('aria-valuenow', String(value));
    track.hidden = (reset ? result.level : result.fromLevel) >= data.BALANCE.levelCap;
    label.textContent =
      up && progress >= 0.45
        ? `LV UP · Lv. ${result.level}`
        : result.fromLevel >= data.BALANCE.levelCap
          ? `Lv. ${result.fromLevel}`
          : `${value} / ${capacity} XP · Lv. ${result.fromLevel}`;
  };
  if (duration > 0) {
    for (let i = 0; i < 7; i++) {
      const coin = document.createElement('span');
      coin.className = 'post-reward-coin post-icon';
      coin.setAttribute('aria-hidden', 'true');
      coin.style.cssText = `${iconStyle('coin')};--coin-x:${(i - 3) * 22}px;--coin-delay:${i * duration * 0.02}ms;--coin-duration:${duration * 0.7}ms`;
      root.append(coin);
    }
    timer = window.setInterval(
      () => update(Math.min(1, (performance.now() - start) / duration)),
      16,
    );
  } else update(1);
  return () => {
    window.clearInterval(timer);
    update(1);
    root.querySelectorAll('.post-reward-coin').forEach((coin) => coin.remove());
  };
}
