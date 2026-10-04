import type Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { motionScale, reducedMotion } from '../../art/motion';
import { t } from '../../i18n';

export const DEPTH_FORK = 20;

const mirrors = new Map<Phaser.Scene, Array<() => void>>();

/** Body overlays and their frame listeners are not owned by Phaser's display list. */
export function clearForkArrows(scene?: Phaser.Scene): void {
  for (const [owner, cleanups] of mirrors) {
    if (scene && owner !== scene) continue;
    cleanups.forEach((cleanup) => cleanup());
    mirrors.delete(owner);
  }
  if (!scene)
    document.querySelectorAll('[data-testid^="fork-arrow-"]').forEach((marker) => marker.remove());
}

/**
 * Animated fork arrows (spec §7): one arrow per branch option, drawn past
 * the midpoint of the edge from the ACTIVE PLAYER'S space (Review 5a: not
 * "the first fork on the map") to each destination while `chooseBranch` is
 * pending. Tapping an arrow or the destination tile dispatches that branch;
 * both stay clickable while the space-info popup is open (Review Focus 3).
 * DOM mirror markers (`fork-arrow-<spaceId>`, Review 5b) keep the arrows
 * reachable for E2E and are cleaned up on redraw.
 */
export function drawForkArrows(
  scene: Phaser.Scene,
  state: GameState,
  onChoose: (to: number) => void,
): Phaser.GameObjects.GameObject[] {
  clearForkArrows(scene);
  if (state.phase.kind !== 'chooseBranch') return [];
  const player = state.players[state.turnSeat];
  const origin =
    state.board.spaces.find((space) => space.id === player?.pos) ??
    state.board.spaces.find((space) => space.next.length > 1);
  const objects: Phaser.GameObjects.GameObject[] = [];
  for (const to of state.phase.options) {
    const destination = state.board.spaces.find((space) => space.id === to);
    if (!destination || !origin) continue;
    const midX = (origin.x + destination.x) / 2;
    const midY = (origin.y + destination.y) / 2;

    const g = scene.add.graphics().setDepth(DEPTH_FORK);
    g.setPosition(midX, midY);
    g.fillStyle(0xf5c51c, 1);
    const angle = Math.atan2(destination.y - origin.y, destination.x - origin.x);
    const size = 18;
    // Chunky triangle pointing at the destination.
    const tipX = Math.cos(angle) * size;
    const tipY = Math.sin(angle) * size;
    const leftX = Math.cos(angle + (2.5 * Math.PI) / 3) * size;
    const leftY = Math.sin(angle + (2.5 * Math.PI) / 3) * size;
    const rightX = Math.cos(angle - (2.5 * Math.PI) / 3) * size;
    const rightY = Math.sin(angle - (2.5 * Math.PI) / 3) * size;
    g.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
    g.lineStyle(4, 0x5c3317, 1);
    g.strokeTriangle(tipX, tipY, leftX, leftY, rightX, rightY);

    const hit = scene.add
      .zone(midX, midY, size * 3, size * 3)
      .setOrigin(0.5)
      .setDepth(DEPTH_FORK + 1)
      .setInteractive({ useHandCursor: true });
    hit.setName(`fork-arrow-${to}`);
    hit.on('pointerdown', () => onChoose(to));
    mirrorForkArrow(scene, () => ({ x: hit.x ?? midX, y: hit.y ?? midY }), to, onChoose);

    if (motionScale() > 0 && !reducedMotion()) {
      scene.tweens.add({
        targets: [g, hit],
        y: midY - 8,
        duration: 500 * motionScale(),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    objects.push(g, hit);
  }
  return objects;
}

/**
 * DOM mirror of one canvas arrow (Review 5b): a transparent button at the
 * arrow's on-screen spot so keyboard/tap assist can reach what the canvas
 * draws. Reproject after rendering: Phaser 4's combined camera matrix
 * includes scroll/zoom, then the canvas rect accounts for FIT/letterboxing.
 */
function mirrorForkArrow(
  scene: Phaser.Scene,
  position: () => { x: number; y: number },
  to: number,
  onChoose: (to: number) => void,
): void {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'fork-arrow-mirror';
  marker.dataset.testid = `fork-arrow-${to}`;
  marker.setAttribute('aria-label', t('action.branch', { to }));
  marker.hidden = true;
  // Phaser also listens on window for mouse events outside its canvas.
  for (const event of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend'])
    marker.addEventListener(event, (event) => event.stopPropagation());
  marker.addEventListener('click', () => onChoose(to));
  document.body.append(marker);
  const update = (): void => {
    const canvas = scene.game.canvas;
    const camera = scene.cameras.main;
    const rect = canvas.getBoundingClientRect();
    const world = position();
    const point = camera.matrixCombined.transformPoint(world.x, world.y);
    const x = rect.left + (point.x / canvas.width) * rect.width;
    const y = rect.top + (point.y / canvas.height) * rect.height;
    marker.hidden =
      !camera.visible ||
      x < rect.left + 24 ||
      x > rect.right - 24 ||
      y < rect.top + 24 ||
      y > rect.bottom - 24;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
  };
  if (scene.game?.canvas) scene.game.events.on('postrender', update);
  const cleanup = (): void => {
    if (scene.game?.canvas) scene.game.events.off('postrender', update);
    marker.remove();
  };
  const cleanups = mirrors.get(scene) ?? [];
  cleanups.push(cleanup);
  mirrors.set(scene, cleanups);
}
