import { onLangChange, t } from '../i18n';
import { playSfx } from '../audio';

const seenKey = 'dice-bandits:intro-seen';
let shownThisPage = false;

export function shouldShowIntroComic(): boolean {
  if (shownThisPage) return false;
  try {
    return localStorage.getItem(seenKey) !== '1';
  } catch {
    return true;
  }
}

/** Title-only view. No game controller, route, save or music state is changed. */
export function openIntroComic({ onClose }: { onClose: () => void }): void {
  if (document.querySelector('[data-testid="intro-comic"]')) return;
  shownThisPage = true;
  const previousFocus = document.activeElement;
  const app = document.querySelector<HTMLElement>('#app');
  const wasInert = app?.inert ?? false;
  if (app) app.inert = true;
  const dialog = document.createElement('section');
  dialog.className = 'intro-comic';
  dialog.dataset.testid = 'intro-comic';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', t('title.story'));
  dialog.tabIndex = -1;
  // Speed is a view policy here, not a gameplay/test hook.
  if (new URLSearchParams(location.search).get('speed') === '0')
    dialog.classList.add('intro-static');
  dialog.innerHTML = `<button class="intro-art" type="button" tabindex="-1"></button>
    <p class="intro-image-status" role="status"></p>
    <div class="intro-bottom"><p class="intro-caption" data-testid="intro-caption" aria-live="polite" aria-atomic="true"></p>
    <nav class="intro-controls"></nav></div>
    <button class="secondary intro-skip" type="button" data-testid="intro-skip"></button>`;
  document.body.append(dialog);
  const art = dialog.querySelector<HTMLButtonElement>('.intro-art')!;
  const status = dialog.querySelector<HTMLElement>('.intro-image-status')!;
  const caption = dialog.querySelector<HTMLElement>('.intro-caption')!;
  const controls = dialog.querySelector<HTMLElement>('.intro-controls')!;
  const skip = dialog.querySelector<HTMLButtonElement>('[data-testid="intro-skip"]')!;
  let panel = 0;
  let closed = false;
  let removeOld: ReturnType<typeof setTimeout> | undefined;
  let imageState: 'loading' | 'ready' | 'error' = 'loading';

  function updateText(): void {
    dialog.setAttribute('aria-label', t('title.story'));
    caption.textContent = t(`intro.caption${panel + 1}`);
    art.setAttribute('aria-label', t(panel === 3 ? 'intro.done' : 'intro.next'));
    const image = art.querySelector<HTMLImageElement>('[data-testid="intro-panel"]');
    if (image) image.alt = t(`intro.caption${panel + 1}`);
    skip.textContent = t('intro.skip');
    controls.setAttribute('aria-label', t('title.story'));
    controls.innerHTML = `<button class="secondary" type="button" data-testid="intro-back" ${panel === 0 ? 'disabled' : ''}></button>
      <span class="intro-dots" aria-hidden="true">${Array.from({ length: 4 }, (_, index) => `<span class="intro-dot ${index === panel ? 'current' : ''}"></span>`).join('')}</span>
      <button class="primary" type="button" data-testid="${panel === 3 ? 'intro-done' : 'intro-next'}"></button>`;
    controls.querySelector('[data-testid="intro-back"]')!.textContent = t('intro.back');
    controls.querySelector('.primary')!.textContent = t(panel === 3 ? 'intro.done' : 'intro.next');
    status.textContent =
      imageState === 'ready'
        ? ''
        : t(imageState === 'error' ? 'intro.imageUnavailable' : 'intro.loading');
    status.hidden = imageState === 'ready';
    // Replacing navigation must not drop keyboard focus outside the modal.
    if (!dialog.contains(document.activeElement)) dialog.focus();
  }

  function showPanel(): void {
    clearTimeout(removeOld);
    art.querySelector('.intro-outgoing')?.remove();
    const old = art.querySelector('picture');
    if (old) {
      old.classList.add('intro-outgoing');
      old.setAttribute('aria-hidden', 'true');
      const oldImage = old.querySelector('img')!;
      delete oldImage.dataset.testid;
      oldImage.alt = '';
    }
    imageState = 'loading';
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.media = '(max-width: 960px)';
    source.srcset = `/art/story/panel${panel + 1}-sm.webp`;
    const image = document.createElement('img');
    image.dataset.testid = 'intro-panel';
    image.width = 1600;
    image.height = 900;
    function finishImage(state: 'ready' | 'error'): void {
      if (closed || !image.hasAttribute('data-testid')) return;
      imageState = state;
      picture.classList.toggle('intro-image-ready', state === 'ready');
      if (old) {
        old.classList.add('intro-fading-out');
        removeOld = setTimeout(() => old.remove(), 250);
      }
      updateText();
    }
    image.addEventListener('load', () => finishImage('ready'));
    image.addEventListener('error', () => finishImage('error'));
    picture.append(source, image);
    art.append(picture);
    image.src = `/art/story/panel${panel + 1}.webp`;
    updateText();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    try {
      localStorage.setItem(seenKey, '1');
    } catch {
      // shownThisPage retains the once-per-load policy even if writes fail.
    }
    clearTimeout(removeOld);
    unsubscribe();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus);
    dialog.remove();
    if (app) app.inert = wasInert;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    onClose();
  }

  function advance(delta: number, sound = false): void {
    if (delta > 0 && panel === 3) {
      close();
      return;
    }
    const next = Math.max(0, Math.min(3, panel + delta));
    if (next === panel) return;
    panel = next;
    if (sound) playSfx('click');
    showPanel();
  }

  function onFocus(event: FocusEvent): void {
    if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.key === 'Tab') {
      const buttons = [
        ...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])'),
      ];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? index <= 0
          ? buttons.length - 1
          : index - 1
        : (index + 1) % buttons.length;
      event.preventDefault();
      buttons[next]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      advance(event.key === 'ArrowRight' ? 1 : -1, true);
    } else if (
      (event.key === 'Enter' || event.key === ' ') &&
      !(event.target instanceof HTMLButtonElement)
    ) {
      event.preventDefault();
      advance(1, true);
    }
  }

  controls.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.testid === 'intro-done') close();
    else advance(button.dataset.testid === 'intro-back' ? -1 : 1);
  });
  // Existing audio listener supplies click SFX for native button clicks.
  art.addEventListener('click', () => advance(1));
  skip.addEventListener('click', close);
  const unsubscribe = onLangChange(updateText);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocus);
  showPanel();
  dialog.focus();
}
