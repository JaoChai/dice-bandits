import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/ui/styles.css'), 'utf8');

describe('styles.css button rules', () => {
  it('opts buttons out of the 300 ms click delay with touch-action manipulation', () => {
    const buttonBlock = css.match(/^button \{[^}]*\}/m);
    expect(buttonBlock).toBeTruthy();
    expect(buttonBlock?.[0]).toContain('touch-action: manipulation');
  });
});
