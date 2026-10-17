import { beforeEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';
import { withHeroNames } from '../../src/tutor/heroNames';
import { TUTORIAL_SCRIPT } from '../../src/tutor/script';

let root: HTMLElement;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('dice-bandits:intro-seen', '1');
  setLang('en');
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector('#app')!;

  return () => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    localStorage.clear();
  };
});

describe('practice hero names', () => {
  it('maps hero seats onto the i18n names without touching the rest of the config', async () => {
    const config = withHeroNames(TUTORIAL_SCRIPT.config, {
      mage: t('hero.mage'),
      thief: t('hero.thief'),
    });
    expect(config).toEqual({
      ...TUTORIAL_SCRIPT.config,
      seats: [
        { name: 'Opal', classId: 'mage', control: 'human', personality: null },
        { name: 'Mint', classId: 'thief', control: 'bot', personality: 'cowardly' },
      ],
    });
  });

  it('begins practice with the localized hero names', async () => {
    const { preparePractice } = await import('../../src/ui/practiceUi');
    let began: typeof TUTORIAL_SCRIPT | undefined;
    const view = preparePractice(
      root,
      (script) => {
        began = script;
      },
      () => undefined,
      async () => TUTORIAL_SCRIPT,
    );
    cleanups.push(view.destroy);
    await view.ready;
    root.querySelector<HTMLButtonElement>('[data-testid="practice-begin"]')!.click();
    expect(began).toBeDefined();
    expect(began!.config.seats.map((seat) => seat.name)).toEqual(['Opal', 'Mint']);
  });
});
