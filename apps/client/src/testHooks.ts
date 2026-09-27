const query = new URLSearchParams(window.location.search);
const speedValue = Number(query.get('speed') ?? 1);

export const testHooks = {
  enabled: import.meta.env.VITE_TEST_HOOKS === '1',
  seed: import.meta.env.VITE_TEST_HOOKS === '1' ? query.get('seed') : null,
  speed: Number.isFinite(speedValue) && speedValue > 0 ? speedValue : 1,
};
