import {
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import { describe, expect, it, vi } from 'vitest';
import { OnlineController } from '../src/online/onlineController';
import { renderHud } from '../src/ui/hud';

const initialState = createGame({
  seed: 'online-controller-test',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

class FakeSocket {
  sent: ClientMsg[] = [];
  send(message: ClientMsg): void {
    this.sent.push(message);
  }
}

function view(
  overrides: Partial<Extract<ServerMsg, { type: 'view' }>> = {},
): Extract<ServerMsg, { type: 'view' }> {
  return {
    type: 'view',
    turn: 12,
    state: structuredClone(initialState),
    you: 0,
    legal: [{ type: 'endTurn' }],
    seats: [
      {
        seat: 0,
        name: 'Human',
        classId: 'knight',
        kind: 'human',
        controller: 'player',
        connected: true,
      },
      { seat: 1, name: 'Bot', classId: 'thief', kind: 'bot', controller: 'bot', connected: true },
    ],
    opponentPicked: false,
    ...overrides,
  };
}

function battleStateWithSeatZeroPicking(): GameState {
  let state = createGame({
    seed: 'online-pvp-test',
    rounds: 12,
    seats: [0, 1].map((seat) => ({
      name: `Human ${seat}`,
      classId: seat === 0 ? 'knight' : 'thief',
      control: 'human' as const,
      personality: null,
    })),
  });
  state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  state.turnSeat = 0;
  state = step(state, { type: 'duel', target: 1 }).state;
  if (state.phase.kind !== 'battle') throw new Error('expected PvP battle');
  const firstPicker = state.players.find((player) =>
    legalActions(state, player.seat).some((action) => action.type === 'battlePick'),
  );
  if (!firstPicker) throw new Error('expected first PvP picker');
  const firstPick = legalActions(state, firstPicker.seat).find(
    (action) => action.type === 'battlePick',
  );
  if (!firstPick) throw new Error('expected legal battle pick');
  state = step(state, firstPick).state;
  if (!legalActions(state, 0).some((action) => action.type === 'battlePick'))
    throw new Error('expected seat 0 to pick second');
  return state;
}

function makeController(
  onEvents: (events: GameEvent[], state: GameState) => Promise<void> = async () => undefined,
) {
  const socket = new FakeSocket();
  const controller = new OnlineController({
    state: structuredClone(initialState),
    socket,
    onEvents,
  });
  return { controller, socket };
}

describe('OnlineController', () => {
  it('uses only server-provided legal actions in the HUD and sends them with the current turn', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(view({ legal: [{ type: 'endTurn' }] }));
    const root = document.createElement('div');
    document.body.append(root);

    renderHud(root, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });

    expect(root.querySelector('[data-testid="action-endTurn"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="action-roll"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    expect(socket.sent).toEqual([{ type: 'action', action: { type: 'endTurn' }, turn: 12 }]);
    root.remove();
  });

  it('uses the server battle picks without showing a pass-the-device screen online', async () => {
    const state = battleStateWithSeatZeroPicking();
    const serverLegal = legalActions(state, 0).filter((action) => action.type === 'battlePick');
    const { controller } = makeController();
    await controller.handleMessage(view({ state, legal: serverLegal, opponentPicked: true }));
    const root = document.createElement('div');
    document.body.append(root);

    renderHud(root, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });

    expect(root.querySelector('[data-testid="pass-screen"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid^="pick-"]')).toHaveLength(serverLegal.length);
    expect(root.querySelector('[data-testid="online-opponent-picked"]')).not.toBeNull();
    root.remove();
  });

  it('waits for event animation before applying the following view', async () => {
    let releaseAnimation!: () => void;
    const animation = new Promise<void>((resolve) => {
      releaseAnimation = resolve;
    });
    const onEvents = vi.fn(() => animation);
    const { controller } = makeController(onEvents);
    await controller.handleMessage(view({ turn: 12 }));
    const next = view({ turn: 13, state: { ...structuredClone(initialState), round: 2 } });
    const events = [{ type: 'turnEnded' } as unknown as GameEvent];

    await controller.handleMessage({ type: 'events', turn: 13, events });
    const applyingView = controller.handleMessage(next);
    await Promise.resolve();

    expect(onEvents).toHaveBeenCalledWith(events, next.state);
    expect(controller.turn).toBe(12);
    releaseAnimation();
    await applyingView;
    expect(controller.turn).toBe(13);
    expect(controller.state.round).toBe(2);
  });

  it('shows takeover and reconnecting banners and reclaims the controlled seat', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(
      view({
        seats: [
          {
            seat: 0,
            name: 'Human',
            classId: 'knight',
            kind: 'human',
            controller: 'botTakeover',
            connected: false,
          },
          {
            seat: 1,
            name: 'Bot',
            classId: 'thief',
            kind: 'bot',
            controller: 'bot',
            connected: true,
          },
        ],
      }),
    );
    const root = document.createElement('div');
    document.body.append(root);
    const render = () =>
      renderHud(root, controller.state, (action) => void controller.dispatch(action), {
        legal: controller.legal,
        online: controller.hudOnlineState,
      });
    render();

    expect(root.querySelector('[data-testid="online-takeover"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="online-reclaim"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="seat-takeover-0"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="online-reclaim"]')!.click();
    expect(socket.sent).toEqual([{ type: 'reclaim' }]);

    controller.setSocketStatus('reconnecting');
    render();
    expect(root.querySelector('[data-testid="online-reconnecting"]')).not.toBeNull();
    root.remove();
  });

  it('does not save online state locally', async () => {
    const saveSpy = vi.spyOn(await import('../src/save'), 'saveGame');
    const { controller } = makeController();
    await controller.handleMessage(view());
    await controller.dispatch({ type: 'endTurn' });
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });
});
