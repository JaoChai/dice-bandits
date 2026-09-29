import { describe, expect, it } from 'vitest';
import { runRoomSimulation, hasAlarmInvariantViolation } from '../src/sim';
import { createRoom } from '../src/model';
import type { RoomStepResult } from '../src/roomStep';

describe('room simulation', () => {
  it('finishes seeded games and exercises battle items without alarm violations', () => {
    const report = runRoomSimulation({ games: 30, seed: 'sim-test-' });

    expect(report).toMatchObject({
      games: 30,
      finished: 30,
      crashes: 0,
      stuck: 0,
      alarmInvariantViolations: 0,
      battleItemsUsed: expect.any(Number),
    });
    expect(report.battleItemsUsed).toBeGreaterThan(0);
  });

  it('detects an alarm scheduled before the current time', () => {
    const room = createRoom('ABCDE', 'Host', 'hash', 0);
    const fake: RoomStepResult = { room, out: [], nextAlarmAt: 4 };

    expect(hasAlarmInvariantViolation(fake, 5)).toBe(true);
  });
});
