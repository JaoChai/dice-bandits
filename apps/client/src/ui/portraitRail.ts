const observedBars = new WeakSet<HTMLElement>();

/** Keep the approved 112px portrait rail unless the real bar overlaps it.
 * Observe the bar, not the rail: changing the offset cannot resize the bar
 * and feed back into another layout. One observer per persistent HUD bar. */
export function syncPortraitRail(shell: HTMLElement): void {
  const bar = shell.querySelector<HTMLElement>('.game-topline');
  if (!bar) return;
  const update = (): void => {
    const portraitBoard =
      window.matchMedia('(orientation: portrait) and (max-width: 900px)').matches &&
      !shell.classList.contains('battle-mode');
    // The bar starts at 6px + safe-area-inset-top. The rail's CSS adds the
    // same safe inset, so use the bar's height + 6px rather than counting
    // that inset twice. Offsets are local to the shell (also in practice).
    const bottom = 6 + bar.getBoundingClientRect().height;
    if (portraitBoard && bottom > 112) {
      shell.style.setProperty('--board-topline-h', `${bottom + 6}px`);
    } else {
      // Includes banner clearing and leaving portrait/board mode. The CSS
      // baseline stays authoritative; default-name banner bottom110 <112.
      shell.style.removeProperty('--board-topline-h');
    }
  };
  update();
  if (observedBars.has(bar)) return;
  observedBars.add(bar);
  const observer = new ResizeObserver(() => {
    if (!shell.isConnected) {
      observer.disconnect();
      observedBars.delete(bar);
      return;
    }
    update();
  });
  observer.observe(bar);
}
