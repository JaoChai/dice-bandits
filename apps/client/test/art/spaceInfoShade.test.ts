import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Review 5b: while the space-info popup is open, clicks on the canvas (fork
 * arrows) must still land. The shade therefore never intercepts pointers;
 * only the popup card itself does.
 */
describe('space-info shade lets canvas clicks through', () => {
  const css = readFileSync(
    join(import.meta.dirname, '../../src/ui/styles.css'),
    'utf8',
  );

  it('disables pointer events on the shade but keeps them on the popup card', () => {
    const shadeBlock = css.match(/\.space-info-shade\s*\{[^}]*\}/)?.[0] ?? '';
    expect(shadeBlock).toContain('pointer-events: none');

    const cardBlock = css.match(/\.space-info\s*\{[^}]*\}/)?.[0] ?? '';
    expect(cardBlock).toContain('pointer-events: auto');
  });

  it('does not style a dead fork-arrow rule that would block the canvas', () => {
    // The popup close button stays clickable (inside the card).
    const closeBlock = css.match(/\.space-info-close\s*\{[^}]*\}/)?.[0] ?? '';
    expect(closeBlock).not.toContain('pointer-events: none');
  });
});
