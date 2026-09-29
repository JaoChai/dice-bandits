import type { ClientMsg, ServerMsg } from '@dice-bandits/room';

export type RoomSocketStatus = 'open' | 'reconnecting' | 'closed';

export interface RoomSocketHandlers {
  onMessage(message: ServerMsg): void;
  onStatus(status: RoomSocketStatus): void;
  onTerminal?(code: number): void;
}

export interface RoomSocketOptions extends RoomSocketHandlers {
  url: string;
  wsFactory?: (url: string) => WebSocket;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
}

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 10000] as const;
const TERMINAL_CLOSE_CODES = new Set([4000, 4404]);

export class RoomSocket {
  private readonly url: string;
  private onMessage: RoomSocketOptions['onMessage'];
  private onStatus: RoomSocketOptions['onStatus'];
  private onTerminal: RoomSocketOptions['onTerminal'];
  private readonly wsFactory: (url: string) => WebSocket;
  private readonly timers: { set: typeof setTimeout; clear: typeof clearTimeout };
  private readonly queue: ClientMsg[] = [];
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryIndex = 0;
  private manuallyClosed = false;
  private connected = false;

  constructor(options: RoomSocketOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
    this.onTerminal = options.onTerminal;
    this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url));
    this.timers = options.timers ?? { set: setTimeout, clear: clearTimeout };
    this.connect();
  }

  setHandlers(handlers: RoomSocketHandlers): void {
    this.onMessage = handlers.onMessage;
    this.onStatus = handlers.onStatus;
    this.onTerminal = handlers.onTerminal;
  }

  send(message: ClientMsg): void {
    if (this.connected && this.socket !== null) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
  }

  close(): void {
    if (this.manuallyClosed) return;
    this.manuallyClosed = true;
    this.connected = false;
    if (this.reconnectTimer !== null) {
      this.timers.clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.onStatus('closed');
  }

  private connect(): void {
    if (this.manuallyClosed) return;
    let socket: WebSocket;
    try {
      socket = this.wsFactory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.manuallyClosed || this.socket !== socket) return;
      this.connected = true;
      this.retryIndex = 0;
      this.onStatus('open');
      while (this.queue.length > 0 && this.connected && this.socket === socket) {
        const message = this.queue.shift();
        if (message !== undefined) socket.send(JSON.stringify(message));
      }
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.manuallyClosed || this.socket !== socket) return;
      let message: ServerMsg;
      try {
        message = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        // Ignore malformed server data and keep the transport alive.
        return;
      }
      this.onMessage(message);
    };
    socket.onerror = () => {
      // Browsers follow an error event with close; reconnect from the close handler.
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.connected = false;
      if (this.manuallyClosed) return;
      if (TERMINAL_CLOSE_CODES.has(event.code)) {
        this.manuallyClosed = true;
        this.onTerminal?.(event.code);
        this.onStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return;
    this.connected = false;
    this.onStatus('reconnecting');
    const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)] ?? 10000;
    this.retryIndex += 1;
    this.reconnectTimer = this.timers.set(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
