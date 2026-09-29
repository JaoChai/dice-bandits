import type { ClientMsg, PublicSeat, ServerMsg } from '@dice-bandits/room';
import type { RoomSession } from './session';
import { clearSession, loadSession, saveSession } from './session';
import { RoomSocket, type RoomSocketOptions, type RoomSocketHandlers } from './socket';
import { getLang, onLangChange, setLang, t } from '../i18n';

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
  const bindCurrentLanguage = (element: HTMLElement, rerender: () => void): void => {
    unsubscribeLanguage();
    unsubscribeLanguage = onLangChange(rerender);
    bindLanguage(element, rerender);
  };
  const showTitle = (): void => {
    unsubscribeLanguage();
    socket?.close();
    socket = null;
    root.dispatchEvent(new CustomEvent('dice-bandits:home'));
  };
  const errorView = (): void => {
    root.innerHTML = `<main class="screen online-screen frame" data-testid="screen-online-error"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button>${languageToggle()}</header><p class="error" role="alert" data-testid="online-error">${escapeHtml(t(errorKey || 'online.error.server'))}</p></main>`;
    bindCurrentLanguage(root, errorView);
    root.querySelector('[data-testid="online-back-title"]')?.addEventListener('click', showTitle);
  };
  const renderClaim = (): void => {
    const candidates = (claimSeats ?? []).filter(
      (item) => item.kind === 'human' && item.controller === 'botTakeover',
    );
    root.innerHTML = `<main class="screen online-screen frame" data-testid="screen-claim"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button>${languageToggle()}</header><h1 class="pixel">${t('online.claim.title')}</h1><p>${t('online.claim.instructions')}</p><div class="online-list">${candidates.map((item) => `<button class="secondary" data-testid="claim-seat-${item.seat}" data-seat="${item.seat}">${escapeHtml(item.name)} · ${t(`class.${item.classId}`)}</button>`).join('')}</div>${candidates.length ? '' : `<p data-testid="online-claim-none">${t('online.claim.none')}</p>`}</main>`;
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
    root.innerHTML = `<main class="screen online-screen frame" data-testid="screen-lobby"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button>${languageToggle()}</header><h1 class="pixel">${t('online.lobby.title')}</h1><div class="room-code"><strong>${escapeHtml(lobby.code)}</strong>&nbsp;&nbsp;<button class="secondary" data-testid="online-copy-link">${t('online.lobby.copyLink')}</button></div><ul class="online-list">${lobby.seats.map((item) => `<li data-testid="lobby-seat-${item.seat}"><span class="seat-portrait portrait-${item.classId}" role="img" aria-label="${t(`class.${item.classId}`)}"></span><strong>${escapeHtml(item.name)}</strong><span>${t(`class.${item.classId}`)}</span>${item.seat === lobby!.host ? `<span class="host-badge">${t('online.lobby.host')}</span>` : ''}</li>`).join('')}</ul><div class="class-picker" aria-label="${t('online.lobby.chooseClass')}">${classes.map((classId) => `<button type="button" class="secondary ${own?.classId === classId ? 'selected' : ''}" data-testid="lobby-class-${classId}" aria-pressed="${own?.classId === classId}">${t(`class.${classId}`)}</button>`).join('')}</div>${lobby.host === session.seat ? `<button class="primary pixel" data-testid="lobby-start">${t('online.lobby.start')}</button>` : ''}</main>`;
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
      mount.innerHTML = `<main class="screen online-screen frame" data-testid="screen-claim"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button>${languageToggle()}</header><h1 class="pixel">${t('online.claim.title')}</h1><p>${t('online.claim.connecting')}</p></main>`;
      bindCurrentLanguage(mount, render);
      mount
        .querySelector('[data-testid="online-back-title"]')
        ?.addEventListener('click', showTitle);
      return;
    }
    mount.innerHTML = `<main class="screen online-screen frame" data-testid="screen-online"><header><button class="text-button" data-testid="online-back-title">← ${t('setup.back')}</button>${languageToggle()}</header><h1 class="pixel">${t('online.title')}</h1><form data-testid="online-form"><label>${t('online.name')}<input data-testid="online-name" name="name" maxlength="16" autocomplete="name" required value="${escapeHtml(name)}"></label>${mode === 'join' ? `<label>${t('online.code')}<input data-testid="online-code" name="code" maxlength="5" autocomplete="off" required value="${escapeHtml(code)}"></label>` : ''}<p class="error" role="alert" data-testid="online-error">${errorKey ? escapeHtml(t(errorKey)) : ''}</p><button class="primary pixel" data-testid="${mode === 'join' ? 'online-join-submit' : 'online-create-submit'}" type="submit">${mode === 'join' ? t('online.join') : t('online.create')}</button></form></main>`;
    bindCurrentLanguage(mount, render);
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
function bindLanguage(root: HTMLElement, rerender: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) =>
    button.addEventListener('click', () => {
      setLang(button.dataset.lang as 'th' | 'en');
      rerender();
    }),
  );
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
