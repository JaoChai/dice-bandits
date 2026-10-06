import type { Action, GameEvent, GameState } from '@dice-bandits/engine';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import type { PublicSeat } from '@dice-bandits/room';
import type { RoomSocketStatus } from './socket';

export interface OnlineTransport {
  send(message: ClientMsg): void;
}

export interface OnlineControllerOptions {
  state: GameState;
  socket: OnlineTransport;
  onEvents: (events: GameEvent[], state: GameState) => Promise<void>;
  onAwaitingViewChange?: (awaiting: boolean) => void;
}

export class OnlineController {
  private currentState: GameState;
  private currentTurn = 0;
  private currentYou = 0;
  private currentLegal: Action[] = [];
  private currentSeats: PublicSeat[] = [];
  private currentOpponentPicked = false;
  private socketStatus: RoomSocketStatus = 'open';
  private pendingEvents: GameEvent[] = [];
  private waitingForView = false;
  private readonly socket: OnlineTransport;
  private readonly onEvents: OnlineControllerOptions['onEvents'];
  private readonly onAwaitingViewChange: NonNullable<
    OnlineControllerOptions['onAwaitingViewChange']
  >;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(options: OnlineControllerOptions) {
    this.currentState = options.state;
    this.socket = options.socket;
    this.onEvents = options.onEvents;
    this.onAwaitingViewChange = options.onAwaitingViewChange ?? (() => undefined);
  }

  get state(): GameState {
    return this.currentState;
  }

  get turn(): number {
    return this.currentTurn;
  }

  get you(): number {
    return this.currentYou;
  }

  get legal(): Action[] {
    return this.currentLegal;
  }

  get seats(): PublicSeat[] {
    return this.currentSeats;
  }

  get opponentPicked(): boolean {
    return this.currentOpponentPicked;
  }

  get hudOnlineState() {
    return {
      you: this.currentYou,
      seats: this.currentSeats,
      opponentPicked: this.currentOpponentPicked,
      socketStatus: this.socketStatus,
      awaitingView: this.waitingForView,
      reclaim: () => this.reclaim(),
    };
  }

  async dispatch(action: Action): Promise<void> {
    if (this.waitingForView) return;
    this.setWaitingForView(true);
    this.socket.send({ type: 'action', action, turn: this.currentTurn });
  }

  reclaim(): void {
    this.socket.send({ type: 'reclaim' });
  }

  setSocketStatus(status: RoomSocketStatus): void {
    this.socketStatus = status;
  }

  handleMessage(message: ServerMsg): Promise<void> {
    const queued = this.messageQueue.then(() => this.applyMessage(message));
    this.messageQueue = queued.catch(() => undefined);
    return queued;
  }

  private setWaitingForView(waiting: boolean): void {
    if (this.waitingForView === waiting) return;
    this.waitingForView = waiting;
    this.onAwaitingViewChange(waiting);
  }

  private async applyMessage(message: ServerMsg): Promise<void> {
    if (message.type === 'events') {
      this.setWaitingForView(true);
      this.pendingEvents.push(...message.events);
      return;
    }
    if (message.type !== 'view') return;

    // This callback also commits scene state. An empty batch has nothing to
    // animate, but its authoritative view must still reach the same commit.
    const events = this.pendingEvents;
    await this.onEvents(events, message.state);
    this.pendingEvents = [];
    this.currentState = message.state;
    this.currentTurn = message.turn;
    this.currentYou = message.you;
    this.currentLegal = message.legal;
    this.currentSeats = message.seats;
    this.currentOpponentPicked = message.opponentPicked;
    this.setWaitingForView(false);
  }
}
