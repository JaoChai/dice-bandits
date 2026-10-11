import type { ClientMsg, PublicSeat, ServerMsg } from '@dice-bandits/room';
import type { RoomSession } from './session';
import { clearSession, loadSession, saveSession } from './session';
import { RoomSocket, type RoomSocketOptions, type RoomSocketHandlers } from './socket';
import { getLang, onLangChange, setLang, t } from '../i18n';
import { MAX_SEATS } from '@dice-bandits/room';
import { portraitStyle } from '../ui/artFrames';
import { titleIcon } from '../ui/titleIcons';
import { openSoundDialog } from '../ui/screens';
import './friends.css';

export interface OnlineSocket {
  send(message: ClientMsg): void;
  close(): void;
  setHandlers(handlers: RoomSocketHandlers): void;
}

export interface OnlineScreensOptions {
  fetcher?: typeof fetch;
  socketFactory?: (options: RoomSocketOptions) => OnlineSocket;
  onStartGame(
    socket: OnlineSocket,
    session: RoomSession,
    firstView: Extract<ServerMsg, { type: 'view' }>,
  ): void;
  initialCode?: string;
  initialMode?: 'create' | 'join';
}

const classes = ['knight', 'thief', 'mage', 'cleric'] as const;

export function showOnlineScreens(options: OnlineScreensOptions): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  const mount = root;
  const fetcher = options.fetcher ?? fetch;
  const makeSocket = options.socketFactory ?? ((socketOptions) => new RoomSocket(socketOptions));
  let socket: OnlineSocket | null = null;
  let session: RoomSession | null = null;
  let lobby: Extract<ServerMsg, { type: 'lobby' }> | null = null;
  let claimSeats: PublicSeat[] | null = null;
  let errorKey = '';
  let mode: 'join' | 'claim' | null = options.initialCode
    ? 'join'
    : options.initialMode === 'join'
      ? 'join'
      : null;
  let code = (options.initialCode ?? '').toUpperCase();
  let name = '';
  let seat = 0;
  let unsubscribeLanguage = (): void => undefined;
  let languageOpen = false;
  const page = (
    testId: string,
    title: string,
    icon: FriendsIcon,
    body: string,
    wide = false,
  ): string => `
    <div class="friends-page"><div class="friends-blur" aria-hidden="true"></div>
      <div class="friends-top"><button type="button" class="title-icon-button" data-testid="online-language" aria-label="${t('title.language')}" aria-expanded="${languageOpen}" aria-controls="friends-languages">${getLang() === 'th' ? 'EN' : 'TH'}</button><div id="friends-languages" class="title-languages" ${languageOpen ? '' : 'hidden'}>${languageToggle()}</div><button type="button" class="title-icon-button" data-testid="audio-settings" aria-label="${t('audio.settings')}">${titleIcon('gear')}</button></div>
      <div class="friends-wrap"><main class="screen online-screen card friends-card${wide ? ' wide' : ''}" data-testid="${testId}"><header class="friends-head"><button type="button" class="title-icon-button" data-testid="online-back-title" aria-label="${t('setup.back')}">${titleIcon('back')}</button><span class="friends-badge" aria-hidden="true">${friendsIcon(icon)}</span><h1>${title}</h1></header>${body}</main></div>
    </div>`;
  const bindCurrentLanguage = (element: HTMLElement, rerender: () => void): void => {
    unsubscribeLanguage();
    unsubscribeLanguage = onLangChange(() => {
      const active = document.activeElement as HTMLElement | null;
      const selector = active?.dataset.lang
        ? `[data-lang="${active.dataset.lang}"]`
        : active?.dataset.testid
          ? `[data-testid="${active.dataset.testid}"]`
          : null;
      rerender();
      if (selector) element.querySelector<HTMLElement>(selector)?.focus();
    });
    bindLanguage(element);
    const languageButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="online-language"]',
    );
    languageButton?.addEventListener('click', () => {
      languageOpen = !languageOpen;
      element.querySelector<HTMLElement>('#friends-languages')!.hidden = !languageOpen;
      languageButton.setAttribute('aria-expanded', String(languageOpen));
      if (languageOpen) element.querySelector<HTMLElement>('[data-lang]')?.focus();
    });
    element.querySelector('.friends-page')?.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || !languageOpen) return;
      event.stopPropagation();
      languageOpen = false;
      element.querySelector<HTMLElement>('#friends-languages')!.hidden = true;
      languageButton?.setAttribute('aria-expanded', 'false');
      languageButton?.focus();
    });
    const settings = element.querySelector<HTMLButtonElement>('[data-testid="audio-settings"]');
    settings?.addEventListener('click', () => openSoundDialog(settings));
  };
  const showTitle = (): void => {
    unsubscribeLanguage();
    socket?.close();
    socket = null;
    root.dispatchEvent(new CustomEvent('dice-bandits:home'));
  };
  const errorView = (): void => {
    root.innerHTML = page(
      'screen-online-error',
      t('online.title'),
      'friends',
      `<p class="error" role="alert" data-testid="online-error">${escapeHtml(t(errorKey || 'online.error.server'))}</p>`,
    );
    bindCurrentLanguage(root, errorView);
    root.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', showTitle);
  };
  const renderClaim = (): void => {
    const candidates = (claimSeats ?? []).filter(
      (item) => item.kind === 'human' && item.controller === 'botTakeover',
    );
    root.innerHTML = page(
      'screen-claim',
      t('online.claim.title'),
      'friends',
      `<p>${t('online.claim.instructions')}</p><div class="online-list">${candidates.map((item) => `<button class="secondary" data-testid="claim-seat-${item.seat}" data-seat="${item.seat}">${escapeHtml(item.name)} · ${t(`class.${item.classId}`)}</button>`).join('')}</div>${candidates.length ? '' : `<p data-testid="online-claim-none">${t('online.claim.none')}</p>`}`,
    );
    bindCurrentLanguage(root, renderClaim);
    root.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', showTitle);
    root.querySelectorAll<HTMLButtonElement>('[data-seat]').forEach((button) =>
      button.addEventListener('click', () => {
        socket?.send({ type: 'claim', seat: Number(button.dataset.seat) });
      }),
    );
  };
  const renderLobby = (): void => {
    if (!lobby || !session) return;
    const focusedClass = document.activeElement
      ?.getAttribute('data-testid')
      ?.startsWith('lobby-class-')
      ? document.activeElement.getAttribute('data-testid')
      : null;
    const own = lobby.seats.find((item) => item.seat === session!.seat);
    const seats = Array.from({ length: MAX_SEATS }, (_, slot) => {
      const item = lobby!.seats.find((candidate) => candidate.seat === slot);
      if (!item)
        return `<li class="friends-seat empty" data-testid="lobby-seat-${slot}">${t('friends.wait')}</li>`;
      const isOwn = item.seat === session!.seat;
      return `<li class="friends-seat${isOwn ? ' me' : ''}" data-testid="lobby-seat-${item.seat}">${item.seat === lobby!.host ? `<span class="host-badge">${friendsIcon('crown')}${t('friends.host')}</span>` : ''}<span class="seat-portrait portrait-${item.classId}" style="${portraitStyle(item.classId)}" role="img" aria-label="${t(`class.${item.classId}`)}"></span><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}${isOwn ? ` <span class="friends-you">(${t('friends.you')})</span>` : ''}</strong><span class="friends-class-name">${t(`class.${item.classId}`)}</span></li>`;
    }).join('');
    root.innerHTML = page(
      'screen-lobby',
      t('friends.lobby'),
      'friends',
      `
      <div class="room-code friends-codebox"><div><div class="friends-code-label">${t('friends.roomCode')}</div><strong>${escapeHtml(lobby.code)}</strong></div><button type="button" class="friends-copy" data-testid="online-copy-link">${friendsIcon('copy')}${t('friends.copy')}</button></div>
      <ul class="friends-seats">${seats}</ul>
      <div class="friends-lobby-foot"><div class="class-picker friends-classes" role="group" aria-label="${t('online.lobby.chooseClass')}"><span>${t('friends.pick')}</span>${classes.map((classId) => `<button type="button" class="friends-class ${own?.classId === classId ? 'selected' : ''}" data-testid="lobby-class-${classId}" aria-pressed="${own?.classId === classId}">${t(`class.${classId}`)}</button>`).join('')}</div>${lobby.host === session.seat ? `<button type="button" class="primary friends-cta" data-testid="lobby-start">${titleIcon('play')}${t('online.lobby.start')}</button>` : ''}</div>`,
      true,
    );
    bindCurrentLanguage(root, renderLobby);
    root.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', showTitle);
    root
      .querySelector<HTMLButtonElement>('[data-testid="online-copy-link"]')
      ?.addEventListener('click', () => {
        void navigator.clipboard?.writeText(`${location.origin}/r/${lobby!.code}`);
      });
    classes.forEach((classId) =>
      root
        .querySelector(`[data-testid="lobby-class-${classId}"]`)
        ?.addEventListener('click', () => socket?.send({ type: 'setClass', classId })),
    );
    root
      .querySelector('[data-testid="lobby-start"]')
      ?.addEventListener('click', () => socket?.send({ type: 'start' }));
    if (focusedClass) root.querySelector<HTMLElement>(`[data-testid="${focusedClass}"]`)?.focus();
  };
  const render = (): void => {
    if (errorKey) return errorView();
    if (mode === 'claim') return claimSeats ? renderClaim() : renderForm();
    if (lobby) return renderLobby();
    renderForm();
  };
  const handleMessage = (message: ServerMsg): void => {
    if (message.type === 'welcome') {
      seat = message.seat;
      if (message.token) {
        session = {
          code,
          seat,
          token: message.token,
          name: (session?.name ?? name) || t('online.defaultName'),
        };
        saveSession(session);
      }
    } else if (message.type === 'lobby') {
      if (!session) {
        // The invite form is already on screen; re-rendering would wipe what the visitor typed.
        if (mode !== 'join') {
          mode = 'join';
          renderForm();
        }
        return;
      }
      lobby = message;
      code = message.code;
      mode = null;
      saveSession(session);
      renderLobby();
    } else if (message.type === 'seats') {
      if (session?.token) {
        // Our saved token no longer matches a seat: another device claimed it.
        clearSession(session.code);
        session = null;
        errorKey = 'online.error.openedElsewhere';
        render();
        return;
      }
      claimSeats = message.seats;
      mode = 'claim';
      renderClaim();
    } else if (message.type === 'view') {
      if (session && message.you === session.seat) {
        options.onStartGame(socket!, session, message);
      }
    } else if (message.type === 'error') {
      errorKey = message.key;
      if (message.key === 'online.error.notFound' && session) clearSession(session.code);
      render();
    }
  };
  const connect = (nextCode: string, nextSession: RoomSession | null, joinName?: string): void => {
    socket?.close();
    code = nextCode.toUpperCase();
    session = nextSession;
    errorKey = '';
    lobby = null;
    claimSeats = null;
    mode = nextSession ? null : joinName ? 'join' : mode;
    const tokenParam = nextSession ? `?token=${encodeURIComponent(nextSession.token)}` : '';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/api/rooms/${code}/ws${tokenParam}`;
    socket = makeSocket({
      url,
      onMessage: handleMessage,
      onStatus: (status) => {
        if (status === 'closed' && !errorKey) {
          errorKey = 'online.error.openedElsewhere';
          render();
        }
      },
      onTerminal: (closeCode) => {
        errorKey = closeCode === 4404 ? 'online.error.notFound' : 'online.error.openedElsewhere';
        if (closeCode === 4404 && session) clearSession(session.code);
        render();
      },
    });
    if (!nextSession && joinName) {
      session = { code, seat: -1, token: '', name: joinName };
      socket.send({ type: 'join', name: joinName });
    }
    render();
  };
  function renderForm(): void {
    if (mode === 'claim') {
      mount.innerHTML = page(
        'screen-claim',
        t('online.claim.title'),
        'friends',
        `<p>${t('online.claim.connecting')}</p>`,
      );
      bindCurrentLanguage(mount, render);
      mount
        .querySelector('[data-testid="online-back-title"]')
        ?.addEventListener('click', showTitle);
      return;
    }
    const joining = mode === 'join';
    mount.innerHTML = page(
      'screen-online',
      t(joining ? 'friends.join' : 'friends.create'),
      joining ? 'key' : 'plus',
      `<form data-testid="online-form"><div class="friends-formrow"><label class="friends-field"><span>${t('friends.name')}</span><input data-testid="online-name" name="name" maxlength="16" autocomplete="name" required value="${escapeHtml(name)}"></label>${joining ? `<label class="friends-field"><span>${t('friends.code')}</span><input class="friends-code-input" data-testid="online-code" name="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" required value="${escapeHtml(code)}"></label>` : ''}</div><p class="error" role="alert" data-testid="online-error">${errorKey ? escapeHtml(t(errorKey)) : ''}</p><button class="primary friends-cta${joining ? ' blue' : ''}" data-testid="${joining ? 'online-join-submit' : 'online-create-submit'}" type="submit">${titleIcon('play')}${t(joining ? 'friends.goJoin' : 'friends.go')}</button><div class="friends-note">${t(joining ? 'friends.noteJ' : 'friends.noteC')}</div></form>`,
    );
    bindCurrentLanguage(mount, render);
    const nameInput = mount.querySelector<HTMLInputElement>('[data-testid="online-name"]');
    nameInput?.addEventListener('input', () => {
      name = nameInput.value;
    });
    mount.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', showTitle);
    const codeInput = mount.querySelector<HTMLInputElement>('[data-testid="online-code"]');
    codeInput?.addEventListener('input', () => {
      codeInput.value = codeInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 5);
      code = codeInput.value;
    });
    mount
      .querySelector<HTMLFormElement>('[data-testid="online-form"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const inputName = mount
          .querySelector<HTMLInputElement>('[data-testid="online-name"]')!
          .value.trim();
        name = inputName;
        if (!inputName || inputName.length > 16) {
          errorKey = 'online.error.badName';
          render();
          return;
        }
        if (mode === 'join') {
          const inputCode = codeInput?.value.toUpperCase() ?? '';
          if (!/^[A-Z0-9]{5}$/.test(inputCode)) {
            errorKey = 'online.error.notFound';
            render();
            return;
          }
          connect(inputCode, null, inputName);
        } else {
          void fetcher('/api/rooms', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: inputName }),
          })
            .then(async (response) => {
              const body = (await response.json()) as {
                code?: string;
                seat?: number;
                token?: string;
                error?: string;
              };
              if (!response.ok || !body.code || body.seat === undefined || !body.token)
                throw new Error(body.error ?? 'online.error.server');
              const created = {
                code: body.code,
                seat: body.seat,
                token: body.token,
                name: inputName,
              };
              saveSession(created);
              connect(created.code, created);
            })
            .catch((error: unknown) => {
              errorKey = error instanceof Error ? error.message : 'online.error.server';
              render();
            });
        }
      });
  }
  if (options.initialCode) {
    const restored = loadSession(options.initialCode);
    if (restored) {
      name = restored.name;
      connect(options.initialCode, restored);
    } else {
      mode = 'join';
      connect(options.initialCode, null);
    }
  } else renderForm();
}

function languageToggle(): string {
  return `<div class="language-toggle" aria-label="${t('title.language')}"><button type="button" data-lang="th" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></div>`;
}
function bindLanguage(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) =>
    button.addEventListener('click', () => {
      setLang(button.dataset.lang as 'th' | 'en');
    }),
  );
}

// Additional decorative SVGs from the approved friends mock; title icons are reused.
const friendsIcons = {
  plus: '<svg viewBox="0 0 32 32" width="34" height="34"><circle cx="16" cy="16" r="12" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><path d="M16 10v12M10 16h12" stroke="#5c3317" stroke-width="3" stroke-linecap="round"/></svg>',
  key: '<svg viewBox="0 0 32 32" width="34" height="34"><circle cx="11" cy="16" r="6" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><path d="M17 16h11M24 16v5M28 16v4" stroke="#5c3317" stroke-width="2.8" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  crown:
    '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 18h18l-2-10-5 4-2-6-2 6-5-4z" fill="#ffc93c" stroke="#5c3317" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
type FriendsIcon = keyof typeof friendsIcons | 'friends';
function friendsIcon(icon: FriendsIcon): string {
  return icon === 'friends'
    ? titleIcon('friends')
    : friendsIcons[icon].replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
