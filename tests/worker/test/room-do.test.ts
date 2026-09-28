import {
  SELF,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { Room } from '../../../apps/client/worker/room-do';

const room = () => env.ROOM.getByName('_probe');

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('message', (event) => resolve(JSON.parse(event.data as string)), {
      once: true,
    });
    socket.addEventListener('error', reject, { once: true });
  });
}

describe('Room Durable Object integration', () => {
  it('connects over WebSocket through the Worker route and echoes a message', async () => {
    const response = await SELF.fetch(
      new Request('https://example.com/api/rooms/_probe/ws', {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeInstanceOf(WebSocket);

    const message = waitForMessage(socket!);
    socket!.accept();
    socket!.send(JSON.stringify({ type: 'echo', data: 'hello' }));
    expect(await message).toEqual({ type: 'echo', data: 'hello' });
    socket!.close();
  });

  it('persists its counter across Durable Object eviction', async () => {
    const stub = room();
    expect(await (await stub.fetch('https://room.test/_probe/counter')).text()).toBe('1');
    await evictDurableObject(stub);
    expect(await (await stub.fetch('https://room.test/_probe/counter')).text()).toBe('2');
  });

  it('runs the scheduled alarm handler', async () => {
    const stub = room();
    await stub.fetch('https://room.test/_probe/alarm');
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const alarmFired = await runInDurableObject(stub, (_instance: Room, state) =>
      state.storage.get<boolean>('alarmFired'),
    );
    expect(alarmFired).toBe(true);
  });
});
