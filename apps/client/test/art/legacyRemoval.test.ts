import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

describe('M5a Task 11c: legacy pixel-atlas pipeline removal', () => {
  it('queues no legacy /sprites assets at boot', async () => {
    const { default: BootScene } = await import('../../src/scenes/BootScene');
    const image = vi.fn();
    const json = vi.fn();
    const text = vi.fn();
    const boot = Object.assign(new BootScene(), {
      load: { image, json, text, on: vi.fn() },
    }) as InstanceType<typeof BootScene>;
    boot.preload();
    // The /sprites manifest fetch and every derived atlas request are gone.
    expect(text).not.toHaveBeenCalled();
    for (const calls of [image.mock.calls, json.mock.calls]) {
      for (const [, url] of calls) expect(String(url)).not.toMatch(/^\/sprites\//);
    }
    // The cartoon /art pipeline still queues its json+image pairs.
    expect(json.mock.calls.length).toBeGreaterThan(0);
    expect(image.mock.calls.length).toBeGreaterThan(0);
  });

  it('deleted the interim pixel-atlas runtime module', async () => {
    // `vitest run` executes with the client workspace as its cwd (the test
    // script's cwd), so this anchors to apps/client/src/art/atlas.ts.
    const atlasModule = join(process.cwd(), 'src', 'art', 'atlas.ts');
    expect(existsSync(atlasModule), 'src/art/atlas.ts must stay deleted').toBe(false);
  });

  it('deleted the legacy interim visual tables module', () => {
    const tablesModule = join(process.cwd(), 'src', 'art', 'tables.ts');
    expect(existsSync(tablesModule), 'src/art/tables.ts must stay deleted').toBe(false);
  });
});
