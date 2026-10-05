import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync('src/ui/theme.css', 'utf8');

/** Palette tokens exactly as the plan's Global Constraints define them. */
const PALETTE: Record<string, string> = {
  '--c-blue': '#2E7FE0',
  '--c-green': '#3BA84A',
  '--c-orange': '#F07818',
  '--c-gold': '#F5C51C',
  '--c-red': '#D42B3A',
  '--c-purple': '#6C2EBE',
  '--c-grey': '#8E8E93',
  '--c-pink': '#F06EA9',
  '--c-cream': '#F5EEDC',
  '--c-cocoa': '#5C3317',
};

describe('cartoon theme tokens', () => {
  it('defines every palette token from the global constraints', () => {
    for (const [token, colour] of Object.entries(PALETTE)) {
      const declaration = new RegExp(
        `${token.replace(/[-[\]{}()*+?.,^$|#\s]/g, '\\$&')}\\s*:\\s*([^;]+);`,
      ).exec(themeCss);
      expect(declaration, `${token} is defined in theme.css`).not.toBeNull();
      expect(declaration![1]!.trim().toLowerCase()).toBe(colour.toLowerCase());
    }
  });
});
