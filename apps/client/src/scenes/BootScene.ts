import Phaser from 'phaser';
import { ART, ART_ATLASES } from '../art/manifest';

export default class BootScene extends Phaser.Scene {
  private readonly artAtlases = new Set<string>();

  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.loadArtAtlases();
  }

  /** Cartoon `/art` atlas basename for a loader suffix (`art-image-<atlas>`). */
  private static artKey(atlas: string): `art:${string}` {
    return `art:${atlas}`;
  }

  /**
   * Cartoon `/art` atlases load under `art:`-prefixed texture keys. A load
   * failure records the key as missing and warns; scenes fall back per
   * Global Constraints.
   */
  private loadArtAtlases(): void {
    for (const atlas of ART_ATLASES) {
      const key = BootScene.artKey(atlas);
      this.artAtlases.add(key);
      this.load.json(`art-json-${atlas}`, `/art/${atlas}.json`);
      this.load.image(`art-image-${atlas}`, `/art/${atlas}.webp`);
    }
    // Authored 5×3 map background (Review 1): plain images under the exact
    // `map-r<row>c<col>` keys mapLayer.ts looks up. A missing tile keeps its
    // key out of the texture manager, so mapLayer warns and falls back.
    for (let row = 0; row < ART.mapTiles.rows; row += 1)
      for (let col = 0; col < ART.mapTiles.cols; col += 1)
        this.load.image(`map-r${row}c${col}`, `/art/map/r${row}c${col}.webp`);
    this.load.on('loaderror', (file: { key: string }) => {
      const atlas = typeof file.key === 'string' ? file.key.replace(/^art-image-/, '') : '';
      if (!atlas || file.key === atlas || !ART_ATLASES.includes(atlas as never)) return;
      this.artAtlases.delete(BootScene.artKey(atlas));
      console.warn('[art] fallback', BootScene.artKey(atlas));
    });
  }

  create(): void {
    this.registerArtAtlases();
    this.scene.start('BoardScene');
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
}

declare global {
  interface Window {
    diceBanditsText: (key: string) => string;
    diceBanditsSpeed: number;
  }
}
