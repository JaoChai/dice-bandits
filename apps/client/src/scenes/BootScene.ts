import Phaser from 'phaser';
import { registerAtlas, type Atlas } from '../art/atlas';

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

  constructor() {
    super('BootScene');
  }

  preload(): void {
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
    const fallbackKeys = atlasKeys.filter((key) => !this.activeAtlases.has(key));
    if (fallbackKeys.length > 0) {
      console.info('[art] using M1 sprites for', fallbackKeys.length, 'keys');
    }
    for (const key of atlasKeys) {
      if (this.failedAtlases.has(key) || !this.activeAtlases.has(key)) {
        // Missing decor atlases stay missing: ground/decor/ambient draw their
        // own per-layer fallbacks. Never alias the __MISSING placeholder.
        const fallbackKey = fallbackTextureKey(key);
        const fallback = fallbackKey ? this.textures.get(fallbackKey) : undefined;
        if (!this.textures.exists(key) && fallback && fallback.key !== '__MISSING') {
          this.textures.addImage(key, fallback.getSourceImage() as HTMLImageElement);
        }
        continue;
      }
      const atlas = this.cache.json.get(key) as Atlas | undefined;
      if (atlas) registerAtlas(this, key, atlas);
    }
    this.scene.start('BoardScene');
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
