export function motionScale(): number {
  return window.diceBanditsSpeed ?? 1;
}

export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Current motion policy as the opts object `puppetTweens` expects. */
export function puppetOptions(): { speed: number; reduced: boolean } {
  return { speed: motionScale(), reduced: reducedMotion() };
}
