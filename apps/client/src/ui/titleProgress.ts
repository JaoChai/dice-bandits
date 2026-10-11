const key = 'dice-bandits:practice-complete';
let completedInMemory = false;
export function hasCompletedPractice(): boolean {
  try {
    return completedInMemory || sessionStorage.getItem(key) === '1';
  } catch {
    return completedInMemory;
  }
}
export function markPracticeComplete(): void {
  completedInMemory = true;
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* Optional persistence. */
  }
}
