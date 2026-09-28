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
  private readonly socket: OnlineTransport;
  private readonly onEvents: OnlineControllerOptions['onEvents'];

  constructor(options: OnlineControllerOptions) {
    this.currentState = options.state;
    this.socket = options.socket;
    this.onEvents = options.onEvents;
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
      reclaim: () => this.reclaim(),
    };
  }

  async dispatch(action: Action): Promise<void> {
    this.socket.send({ type: 'action', action, turn: this.currentTurn });
  }

  reclaim(): void {
    this.socket.send({ type: 'reclaim' });
  }

  setSocketStatus(status: RoomSocketStatus): void {
    this.socketStatus = status;
  }

  async handleMessage(message: ServerMsg): Promise<void> {
    if (message.type === 'events') {
      this.pendingEvents.push(...message.events);
      return;
    }
    if (message.type !== 'view') return;

    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents;
      await this.onEvents(events, message.state);
      this.pendingEvents = [];
    }
    this.currentState = message.state;
    this.currentTurn = message.turn;
    this.currentYou = message.you;
    this.currentLegal = message.legal;
    this.currentSeats = message.seats;
    this.currentOpponentPicked = message.opponentPicked;
  }
}
