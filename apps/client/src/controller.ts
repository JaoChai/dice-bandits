import {
  chooseAction,
  legalActions,
  step,
  type Action,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { saveGame } from './save';

type Side = 'a' | 'b';
type ActingSide = { seat: number; side?: Side };

const BOT_ACTION_DELAY_MS = 100;

export class GameController {
  private currentState: GameState;
  private readonly speed: number;
  private readonly onEvents: (events: GameEvent[], state: GameState) => Promise<void>;
  private botRun: Promise<void> | null = null;
  private dispatching = false;

  constructor(opts: {
    state: GameState;
    speed: number;
    onEvents: (events: GameEvent[], state: GameState) => Promise<void>;
  }) {
    this.currentState = opts.state;
    this.speed = Math.max(0, opts.speed);
    this.onEvents = opts.onEvents;
    saveGame(this.currentState);
  }

  get state(): GameState {
    return this.currentState;
  }

  pendingHumanSides(): Array<{ seat: number; side: Side }> {
    return this.actingSides()
      .filter(({ seat }) => this.currentState.players[seat]?.control === 'human')
      .map(({ seat, side }) => ({ seat, side: side ?? 'a' }));
  }

  isHumanTurn(): boolean {
    return this.pendingHumanSides().length > 0;
  }

  async dispatch(action: Action): Promise<void> {
    // The HUD may expose the next action before the current animation finishes.
    // Never let a second state update tear down its scene/tween mid-await.
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      let result;
      try {
        result = step(this.currentState, action);
      } catch (error) {
        console.error(error);
        return;
      }
      this.currentState = jsonState(result.state);
      saveGame(this.currentState);
      await this.onEvents(result.events, this.currentState);
      await this.runBotsIfNeeded();
    } finally {
      this.dispatching = false;
    }
  }

  private actingSides(): ActingSide[] {
    const state = this.currentState;
    if (state.phase.kind === 'gameOver') return [];
    if (state.phase.kind === 'battle') {
      return state.players.flatMap((player) =>
        legalActions(state, player.seat).some((action) => action.type === 'battlePick')
          ? [
              {
                seat: player.seat,
                side: state.phase.kind === 'battle' ? pendingBattleSide(state) : undefined,
              },
            ]
          : [],
      );
    }
    const seat =
      state.phase.kind === 'pvpReward'
        ? state.phase.winner
        : state.phase.kind === 'levelUp'
          ? state.phase.seat
          : state.turnSeat;
    return legalActions(state, seat).length ? [{ seat }] : [];
  }

  private async runBotsIfNeeded(): Promise<void> {
    if (this.botRun) return this.botRun;
    this.botRun = (async () => {
      while (this.currentState.phase.kind !== 'gameOver') {
        const actor = this.actingSides().find(
          ({ seat }) => this.currentState.players[seat]?.control === 'bot',
        );
        if (!actor) break;
        const legal = legalActions(this.currentState, actor.seat);
        if (!legal.length) break;
        await delay(BOT_ACTION_DELAY_MS * this.speed);
        const currentActor = this.actingSides().find(
          ({ seat }) => this.currentState.players[seat]?.control === 'bot',
        );
        if (!currentActor) break;
        if (!legalActions(this.currentState, currentActor.seat).length) continue;
        await this.dispatchBotAction(currentActor.seat);
      }
    })().finally(() => {
      this.botRun = null;
    });
    return this.botRun;
  }

  private async dispatchBotAction(seat: number): Promise<void> {
    try {
      const result = step(this.currentState, chooseAction(this.currentState, seat));
      this.currentState = jsonState(result.state);
      saveGame(this.currentState);
      await this.onEvents(result.events, this.currentState);
    } catch (error) {
      console.error(error);
      saveGame(this.currentState);
    }
  }
}

function jsonState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function pendingBattleSide(state: GameState): Side {
  if (state.phase.kind !== 'battle') return 'a';
  const battle = state.phase.battle;
  return battle.pending.attack === null
    ? battle.attackerSide
    : battle.attackerSide === 'a'
      ? 'b'
      : 'a';
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}
