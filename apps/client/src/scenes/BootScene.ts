import Phaser from 'phaser';
import { registerAtlas, type Atlas } from '../art/atlas';
import { ART_ATLASES } from '../art/manifest';

const regions = ['meadow', 'desert', 'snow', 'volcano'] as const;
const classes = ['knight', 'thief', 'mage', 'cleric'] as const;
const monsters = [
  'goldSlime',
  'mushroomBandit',
  'lanternGhost',
  'mimic',
  'rockGolem',
  'shadowImp',
] as const;
const atlasKeys = [
  ...classes.flatMap((id) => [`hero-${id}`, `token-${id}`, `portrait-${id}`]),
  ...monsters.map((id) => `monster-${id}`),
  ...regions.flatMap((id) => [`ground-${id}`, `props-${id}`, `ambient-${id}`]),
  'tiles',
  'fx',
  'cards',
  ...regions.map((id) => `backdrop-${id}`),
];

const atlasImageKeys = new Set(atlasKeys.map((key) => `${key}-atlas-image`));
const legacyImageKeys = new Set([
  ...regions.map((region) => `tile-${region}`),
  ...classes.map((id) => `hero-${id}`),
  'icons',
]);

/** Board-layer atlases whose draw code has per-layer fallbacks: never alias. */
const DECOR_PREFIXES = ['ground-', 'props-', 'ambient-'];

function fallbackTextureKey(key: string): string {
  if (DECOR_PREFIXES.some((prefix) => key.startsWith(prefix))) return '';
  if (key.startsWith('hero-')) return key;
  if (key.startsWith('token-') || key.startsWith('portrait-')) return `hero-${key.split('-')[1]}`;
  if (key.startsWith('board-') || key.startsWith('backdrop-'))
    return `tile-${key.slice(key.indexOf('-') + 1)}`;
  if (key.startsWith('monster-') || ['tiles', 'fx', 'cards'].includes(key)) return 'icons';
  return 'icons';
}

export default class BootScene extends Phaser.Scene {
  private readonly failedAtlases = new Set<string>();
  private readonly warnedAtlases = new Set<string>();
  private readonly activeAtlases = new Set<string>();
  private readonly artAtlases = new Set<string>();

  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.loadArtAtlases();
    for (const region of regions) this.load.image(`tile-${region}`, `/sprites/tiles-${region}.png`);
    for (const hero of classes) this.load.image(`hero-${hero}`, `/sprites/hero-${hero}.png`);
    this.load.image('icons', '/sprites/icons.png');

    this.load.on(
      'filecomplete-text-atlas-manifest',
      (_key: string, _type: string, data: string) => {
        const manifest = this.parseAtlasManifest(data);
        for (const key of manifest) {
          this.activeAtlases.add(key);
          this.load.json(key, `/sprites/${key}.json`);
          this.load.image(`${key}-atlas-image`, `/sprites/${key}.png`);
        }
      },
    );

    this.load.on('loaderror', (file: { key: string }) => {
      if (file.key === 'atlas-manifest') return;
      const atlasKey = atlasImageKeys.has(file.key)
        ? file.key.slice(0, -'-atlas-image'.length)
        : this.activeAtlases.has(file.key)
          ? file.key
          : undefined;
      if (atlasKey) {
        this.failedAtlases.add(atlasKey);
        if (!this.warnedAtlases.has(atlasKey)) {
          console.warn('[art] fallback', atlasKey);
          this.warnedAtlases.add(atlasKey);
        }
        return;
      }
      if (legacyImageKeys.has(file.key)) this.showAssetError();
    });

    this.load.text('atlas-manifest', '/sprites/atlases.json');
  }

  /** Cartoon `/art` atlas basename for a loader suffix (`art-image-<atlas>`). */
  private static artKey(atlas: string): `art:${string}` {
    return `art:${atlas}`;
  }

  /**
   * Cartoon `/art` atlases load under `art:`-prefixed texture keys so they
   * never alias the interim pixel-art pipeline (removed in Task 11). A load
   * failure records the key as missing and warns; scenes fall back.
   */
  private loadArtAtlases(): void {
    for (const atlas of ART_ATLASES) {
      const key = BootScene.artKey(atlas);
      this.artAtlases.add(key);
      this.load.json(`art-json-${atlas}`, `/art/${atlas}.json`);
      this.load.image(`art-image-${atlas}`, `/art/${atlas}.webp`);
    }
    this.load.on('loaderror', (file: { key: string }) => {
      const atlas = typeof file.key === 'string' ? file.key.replace(/^art-image-/, '') : '';
      if (!atlas || file.key === atlas || !ART_ATLASES.includes(atlas as never)) return;
      this.artAtlases.delete(BootScene.artKey(atlas));
      console.warn('[art] fallback', BootScene.artKey(atlas));
    });
  }

  private parseAtlasManifest(data: string): string[] {
    try {
      const manifest = JSON.parse(data) as { atlases?: unknown };
      if (!Array.isArray(manifest.atlases)) return [];
      return [
        ...new Set(
          manifest.atlases.filter(
            (key): key is string => typeof key === 'string' && atlasKeys.includes(key),
          ),
        ),
      ];
    } catch {
      return [];
    }
  }

  create(): void {
    this.registerArtAtlases();
    for (const key of atlasKeys) {
      const atlas =
        this.failedAtlases.has(key) || !this.activeAtlases.has(key)
          ? undefined
          : (this.cache.json.get(key) as Atlas | undefined);
      if (atlas && registerAtlas(this, key, atlas)) continue;
      if (!atlas && !this.warnedAtlases.has(key)) {
        console.warn('[art] fallback', key);
        this.warnedAtlases.add(key);
      }
      // Missing decor atlases stay missing: ground/decor/ambient draw their
      // own per-layer fallbacks. Never alias the __MISSING placeholder.
      const fallbackKey = fallbackTextureKey(key);
      const fallback = fallbackKey ? this.textures.get(fallbackKey) : undefined;
      if (!this.textures.exists(key) && fallback && fallback.key !== '__MISSING') {
        this.textures.addImage(key, fallback.getSourceImage() as HTMLImageElement);
      }
    }
    this.scene.start('BoardScene');
    const state = this.game?.registry?.get('state') as { phase?: { kind?: string } } | undefined;
    if (state?.phase?.kind === 'battle') this.scene.launch('BattleScene');
  }

  /**
   * Turn each loaded `/art` json+image pair into a named-frame atlas under
   * its `art:` texture key, then publish `artReady` to the registry. A pair
   * whose json or image failed to load stays missing (warned during
   * preload); scenes consult `artReady` and fall back per Global Constraints.
   */
  private registerArtAtlases(): void {
    for (const atlas of ART_ATLASES) {
      const key = BootScene.artKey(atlas);
      if (!this.artAtlases.has(key)) continue;
      const json = this.cache.json.get(`art-json-${atlas}`) as
        { frames?: Record<string, unknown> } | undefined;
      if (
        !json ||
        typeof json !== 'object' ||
        !json.frames ||
        typeof json.frames !== 'object' ||
        Array.isArray(json.frames)
      ) {
        this.artAtlases.delete(key);
        console.warn('[art] fallback', key);
        continue;
      }
      if (this.textures.exists(key)) this.textures.remove(key);
      const source = this.textures.get(`art-image-${atlas}`).getSourceImage() as HTMLImageElement;
      const texture = this.textures.addImage(key, source);
      if (!texture) {
        this.artAtlases.delete(key);
        console.warn('[art] fallback', key);
        continue;
      }
      for (const [pose, frame] of Object.entries(json.frames)) {
        const { x, y, w, h } = frame as { x: number; y: number; w: number; h: number };
        const added = texture.add(pose, 0, x, y, w, h);
        if (added === null) {
          this.artAtlases.delete(key);
          console.warn('[art] fallback', key);
          break;
        }
      }
    }
    this.game?.registry?.set('artReady', new Set(this.artAtlases));
  }

  private showAssetError(): void {
    if (document.querySelector('[data-testid="asset-error"]')) return;
    const panel = document.createElement('div');
    panel.className = 'error-panel';
    panel.dataset.testid = 'asset-error';
    panel.innerHTML = `<p>${window.diceBanditsText('board.assetError')}</p><button type="button">${window.diceBanditsText('board.retry')}</button>`;
    panel.querySelector('button')?.addEventListener('click', () => window.location.reload());
    document.querySelector('#game-root')?.append(panel);
  }
}

declare global {
  interface Window {
    diceBanditsText: (key: string) => string;
    diceBanditsSpeed: number;
  }
}
