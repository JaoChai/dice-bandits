import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { CDPSession } from '@playwright/test';
import { playUntil, startTestGame } from './helpers';

let cdp: CDPSession;
test.afterEach(async () => {
  const cpu = await cdp.send('Profiler.stop');
  await writeFile(test.info().outputPath('cpu.json'), JSON.stringify(cpu.profile));
  const done = new Promise<{ stream: string }>((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve),
  );
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let content = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    content += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  await writeFile(test.info().outputPath('native.json'), content);
});

test('native profile of unchanged full journey', async ({ page }) => {
  test.setTimeout(90_000);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await cdp.send('Tracing.start', {
    categories:
      '-*,toplevel,devtools.timeline,blink,cc,gpu,viz,renderer.scheduler,disabled-by-default-gpu.service',
    transferMode: 'ReturnAsStream',
    traceConfig: undefined,
  });
  await startTestGame(page);
  await playUntil(page, (state) => state.phase.kind === 'gameOver');
});
