import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n';
import { artBackground, CARD_ICON, ICON_FRAMES, PORTRAIT_FRAMES } from '../../src/ui/artFrames';
import { renderHud } from '../../src/ui/hud';
import { showSetup } from '../../src/ui/screens';

/**
 * M5a Task 11a: HUD portraits and battle card icons read the cartoon /art
 * sheets. The frame tables must stay in lockstep with the generated JSON
 * (re-read from disk here), and every moved consumer must carry an /art/
 * inline style — never a /sprites/ URL again.
 */

type Frame = { x: number; y: number; w: number; h: number; anchorX: number; anchorY: number };

const artDir = join(process.cwd(), 'public', 'art');
const iconsJson = JSON.parse(readFileSync(join(artDir, 'icons.json'), 'utf8')) as {
  frames: Record<string, Frame>;
};
const heroPortraitFrame = (classId: string): Frame => {
  const sheet = JSON.parse(readFileSync(join(artDir, `hero-${classId}.json`), 'utf8')) as {
    frames: Record<string, Frame>;
  };
  return sheet.frames.portrait!;
};

const styleOf = (element: Element | null): string => element?.getAttribute('style') ?? '';

afterEach(() => setLang('en'));

describe('cartoon frame tables (M5a T11a)', () => {
  it('copies the portrait frame of every hero sheet', () => {
    for (const classId of ['knight', 'thief', 'mage', 'cleric'] as const) {
      expect(PORTRAIT_FRAMES[classId]).toEqual(heroPortraitFrame(classId));
    }
  });

  it('copies the seven icon frames the UI uses from icons.json', () => {
    for (const name of ['sword', 'shield', 'scroll', 'star', 'skull', 'piggy', 'coin'] as const) {
      expect(ICON_FRAMES[name]).toEqual(iconsJson.frames[name]);
    }
  });

  it('maps every battle pick and the item card to its icon (Lead decision)', () => {
    expect(CARD_ICON).toEqual({
      attack: 'sword',
      strike: 'star',
      secret: 'scroll',
      defend: 'shield',
      counter: 'skull',
      item: 'piggy',
    });
  });

  it('computes a known portrait crop at box 40', () => {
    expect(artBackground('hero-knight', PORTRAIT_FRAMES.knight, 1920, 300, 40)).toBe(
      "background-image:url('/art/hero-knight.webp');background-size:364px 57px;background-position:-315px -17px",
    );
  });

  it('computes a known icon crop at box 32', () => {
    expect(artBackground('icons', ICON_FRAMES.sword, 512, 512, 32)).toBe(
      "background-image:url('/art/icons.webp');background-size:138px 138px;background-position:-73px -2px",
    );
  });
});

function battleState(pendingAttack: 'attack' | null = null): GameState {
  const state = createGame({
    seed: 'art-frames',
    rounds: 12,
    seats: [
      { name: 'Hero', classId: 'knight', control: 'human', personality: null },
      { name: 'Rival', classId: 'thief', control: 'human', personality: null },
    ],
  });
  const a = state.players[0]!;
  const b = state.players[1]!;
  state.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: a.pos,
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: a.level,
        hp: 38,
        stats: a.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: b.level,
        hp: 12,
        stats: b.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: pendingAttack, defense: null },
    },
  };
  return state;
}

describe('cartoon consumers (M5a T11a)', () => {
  it('HUD corner-card portraits carry an /art/ inline style and never /sprites/', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderHud(
      root,
      createGame({
        seed: 'art-frames',
        rounds: 12,
        seats: [
          { name: 'Hero', classId: 'knight', control: 'human', personality: null },
          { name: 'Rival', classId: 'thief', control: 'human', personality: null },
        ],
      }),
      vi.fn(),
    );
    const portraits = root.querySelectorAll<HTMLElement>('.seat-card .seat-portrait');
    expect(portraits.length).toBeGreaterThan(0);
    const styles = [...portraits].map(styleOf);
    for (const style of styles) {
      expect(style).toContain('/art/hero-');
      expect(style).not.toContain('/sprites/');
    }
    expect(styles.join('')).toContain('/art/hero-knight.webp');
    expect(styles.join('')).toContain('/art/hero-thief.webp');
    root.remove();
  });

  it('setup seat-row portraits carry an /art/ inline style and never /sprites/', () => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    showSetup(vi.fn());
    const portraits = app.querySelectorAll<HTMLElement>('.seat-row .seat-portrait');
    expect(portraits).toHaveLength(4);
    for (const portrait of portraits) {
      const style = styleOf(portrait);
      expect(style).toContain('/art/hero-');
      expect(style).not.toContain('/sprites/');
    }
    app.remove();
  });

  it('pass screen and every command card carry /art/ inline styles and never /sprites/', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderHud(root, battleState(), vi.fn());
    const pass = root.querySelector<HTMLElement>('[data-testid="pass-screen"] .pass-portrait');
    expect(pass, 'pass screen portrait').not.toBeNull();
    expect(styleOf(pass)).toContain('/art/hero-knight.webp');
    expect(styleOf(pass)).not.toContain('/sprites/');
    root.querySelector<HTMLButtonElement>('[data-testid="pass-ready"]')?.click();
    for (const pick of ['attack', 'strike', 'secret'] as const) {
      const icon = root.querySelector<HTMLElement>(`[data-testid="pick-${pick}"] .card-icon`);
      expect(icon, `icon for ${pick}`).not.toBeNull();
      expect(styleOf(icon)).toContain('/art/icons.webp');
      expect(styleOf(icon)).not.toContain('/sprites/');
    }
    root.remove();

    const defender = document.createElement('div');
    document.body.append(defender);
    renderHud(defender, battleState('attack'), vi.fn());
    defender.querySelector<HTMLButtonElement>('[data-testid="pass-ready"]')?.click();
    for (const pick of ['defend', 'counter', 'secret'] as const) {
      const icon = defender.querySelector<HTMLElement>(`[data-testid="pick-${pick}"] .card-icon`);
      expect(icon, `icon for ${pick}`).not.toBeNull();
      expect(styleOf(icon)).toContain('/art/icons.webp');
      expect(styleOf(icon)).not.toContain('/sprites/');
    }
    defender.remove();
  });

  it('styles.css drops every /sprites/ reference', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'styles.css'), 'utf8');
    expect(css).not.toContain('/sprites/');
  });
});
