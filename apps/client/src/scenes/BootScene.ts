import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    for (const region of ['meadow', 'desert', 'snow', 'volcano'])
      this.load.image(`tile-${region}`, `/sprites/tiles-${region}.png`);
    for (const hero of ['knight', 'thief', 'mage', 'cleric'])
      this.load.image(`hero-${hero}`, `/sprites/hero-${hero}.png`);
    this.load.image('icons', '/sprites/icons.png');
    this.load.on('loaderror', () => {
      const panel = document.createElement('div');
      panel.className = 'error-panel';
      panel.dataset.testid = 'asset-error';
      panel.innerHTML = `<p>${window.diceBanditsText('board.assetError')}</p><button type="button">${window.diceBanditsText('board.retry')}</button>`;
      panel.querySelector('button')?.addEventListener('click', () => window.location.reload());
      document.querySelector('#game-root')?.append(panel);
    });
  }

  create(): void {
    this.scene.start('BoardScene');
  }
}

declare global {
  interface Window {
    diceBanditsText: (key: string) => string;
    diceBanditsSpeed: number;
  }
}
