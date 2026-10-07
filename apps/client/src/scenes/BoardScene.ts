import Phaser from 'phaser';
import type { GameState, GameEvent } from '@dice-bandits/engine';
import { coinBurst, dice, dustPuff, shake } from '../fx';
import { reducedMotion, motionScale } from '../art/motion';
import { seatColors, seatTint } from '../art/colors';
import { createHeroToken, tokenLayout } from './board/tokens';
import { drawRoad } from './board/road';
import { drawTiles } from './board/tiles';
import { drawBuildings } from './board/buildings';
import { boardViewport, cameraBounds, cameraTarget, gameplayZoom, WORLD } from './board/camera';
import { drawMapLayer, roadSegments, validate } from './board/mapLayer';
import { clearForkArrows, drawForkArrows } from './board/forkArrows';
import { drawAmbients } from './board/ambient';
import { bindSpaceTaps } from './board/spaceTaps';
import { closeSpaceInfo } from '../ui/spaceInfo';
import { t } from '../i18n';
import { planMovement } from './board/movementPlan';
import { createMovementOverlay } from './board/movementOverlay';

/**
 * M5a board: the authored 3200×1800 map drawn once in map pixels (painted
 * tiles, road, buildings, spaces), viewed through a follow camera that eases
 * to the active seat and supports the whole-map toggle. A board produced by
 * a different map (pre-deploy online room) is rejected before anything draws.
 */
export default class BoardScene extends Phaser.Scene {
  private tokenObjects = new Map<number, Phaser.GameObjects.Image>();
  private mapImages: Phaser.GameObjects.Image[] = [];
  private spacePositions = new Map<number, { x: number; y: number }>();
  private renderSignature = '';
  private wholeMap = false;
  private ringTween: Phaser.Tweens.Tween | null = null;
  private latestState: GameState | null = null;
  private onlineMovement: ReturnType<typeof createMovementOverlay> | undefined;
  private backdropCamera: Phaser.Cameras.Scene2D.Camera | null = null;

  /** HUD geometry is read only on redraw/resize, never on an animation frame.
   * DOM lane bounds also carry the CSS env(safe-area-inset-*) offsets. */
  private playfieldViewport() {
    const canvas = this.game.canvas;
    const logical = canvas ? { width: canvas.width, height: canvas.height } : this.cameras.main;
    const css = canvas?.getBoundingClientRect() ?? {
      width: logical.width,
      height: logical.height,
      left: 0,
      top: 0,
      right: logical.width,
      bottom: logical.height,
    };
    const top = document
      .querySelector('.game-shell:not(.battle-mode) .game-topline')
      ?.getBoundingClientRect();
    const rail = document
      .querySelector('.game-shell:not(.battle-mode) .seat-hud')
      ?.getBoundingClientRect();
    const tray = document
      .querySelector('.game-shell:not(.battle-mode) .action-tray')
      ?.getBoundingClientRect();
    return boardViewport(logical, css, {
      left: Math.max(8, top ? top.left - css.left : 0),
      top: Math.max(58, top ? top.bottom - css.top + 4 : 0),
      right: Math.max(css.height >= 600 ? 184 : 136, rail ? css.right - rail.left + 16 : 0),
      bottom: Math.max(60, tray ? css.bottom - tray.top + 8 : 0),
    });
  }

  private applyViewports(): void {
    if (!this.backdropCamera) return;
    const safe = this.playfieldViewport();
    this.cameras.main.setViewport(safe.x, safe.y, safe.width, safe.height);
    const canvas = this.game.canvas;
    this.backdropCamera.setViewport(0, 0, canvas?.width ?? 1280, canvas?.height ?? 720);
    const bounds = cameraBounds(this.backdropCamera, true);
    this.backdropCamera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.backdropCamera.setZoom(
      Math.min(this.backdropCamera.width / WORLD.width, this.backdropCamera.height / WORLD.height),
    );
    this.backdropCamera.centerOn(WORLD.width / 2, WORLD.height / 2);
  }

  private drawPaintedMap(): void {
    // Both passes share native map textures and the existing culling gate.
    // Paint the union of their whole-map gutters, not just the safe viewport.
    const a = cameraBounds(this.cameras.main, true);
    const b = cameraBounds(this.backdropCamera ?? this.cameras.main, true);
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y);
    this.mapImages = drawMapLayer(this, {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.y + a.height, b.y + b.height) - y,
    });
    if (this.backdropCamera)
      for (const image of this.mapImages) image.cameraFilter &= ~this.backdropCamera.id;
  }

  constructor() {
    super('BoardScene');
  }

  create(): void {
    // Keep the zoomed viewport on the painted map, including during follow
    // tweens and whole-map transitions. Otherwise a start near the left edge
    // centres on negative world coordinates and reveals the renderer background.
    this.backdropCamera = this.cameras.main;
    this.backdropCamera.inputEnabled = false;
    const safe = this.playfieldViewport();
    const gameplayCamera = this.cameras.add(
      safe.x,
      safe.y,
      safe.width,
      safe.height,
      true,
      'board-playfield',
    );
    // Fail closed: late dust/coin effects and interactive zones are foreground
    // too. Only explicitly identified painted-map objects enter the backdrop.
    const onAdded = (object: Phaser.GameObjects.GameObject): void => {
      this.backdropCamera?.ignore(object);
    };
    this.events.on('addedtoscene', onAdded);
    this.applyViewports();
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setScroll(0, 0);
    const onState = (state: GameState): void => this.renderBoard(state);
    const onResize = (): void => {
      this.cancelOnlineMovement();
      this.applyViewports();
      if (!this.latestState) return;
      for (const image of this.mapImages) image.destroy();
      this.drawPaintedMap();
      const target = cameraTarget(this.latestState, this.wholeMap, this.cameras.main);
      this.applyCamera({ ...target, duration: 0 });
    };
    this.scale.on('resize', onResize);
    this.game.events.on('game-state', onState);
    this.events.once('destroy', () => this.cancelOnlineMovement());
    this.events.once('shutdown', () => {
      this.cancelOnlineMovement();
      this.scale.off('resize', onResize);
      this.events.off('addedtoscene', onAdded);
      this.tweens.killTweensOf(gameplayCamera);
      this.cameras.remove(gameplayCamera);
      if (this.backdropCamera) this.cameras.main = this.backdropCamera;
      this.backdropCamera = null;
      this.game.events.off('game-state', onState);
      clearForkArrows(this);
      closeSpaceInfo();
    });
    const initial = this.game.registry.get('state') as GameState | undefined;
    if (initial) {
      this.renderBoard(initial);
      // Boot's scene.start is queued. A battle may arrive after Boot checked
      // state but before this scene is active, so main cannot launch it yet.
      // Reconcile the latest registry state at the actual board startup.
      if (initial.phase.kind === 'battle' && !this.scene.isActive('BattleScene'))
        this.scene.launch('BattleScene');
    }
  }

  /**
   * Review Focus 2: a view whose space ids/coordinates do not match the
   * authored map is rejected; main.ts surfaces `error.boardOutdated` and
   * returns to the title instead of drawing a nonsense board.
   */
  static validate(board: GameState['board']): boolean {
    return validate(board);
  }

  /** Called only after the authoritative registry/view commit. Never await
   * this cosmetic layer or pan the camera away from a newly actionable seat. */
  presentOnlineMovement(
    previous: GameState,
    next: GameState,
    events: readonly GameEvent[],
    generation: number,
  ): void {
    this.cancelOnlineMovement();
    if (!this.scene.isActive() || next.phase.kind === 'battle' || next.phase.kind === 'gameOver')
      return;
    this.onlineMovement = createMovementOverlay(this);
    this.onlineMovement.play(planMovement(previous, events, 'online'), generation);
  }

  cancelOnlineMovement(): void {
    this.onlineMovement?.destroy();
    this.onlineMovement = undefined;
  }

  async playEvents(events: GameEvent[]): Promise<void> {
    const speed = window.diceBanditsSpeed;
    for (const event of events) {
      const token = event.seat === null ? undefined : this.tokenObjects.get(event.seat);
      if (event.type === 'DiceRolled' && token) {
        dice(this, token, speed);
        await wait(350 * speed);
      } else if (event.type === 'Moved' && token) {
        const destination = this.spacePositions.get(Number(event.params.to));
        if (destination) {
          const movingLeft = destination.x < token.x;
          token.setFlipX(movingLeft);
          if (speed > 0) {
            await new Promise<void>((resolve) => {
              this.tweens.add({
                targets: token,
                x: destination.x,
                y: destination.y,
                duration: 200 * speed,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                  dustPuff(this, destination.x, destination.y, speed);
                  resolve();
                },
              });
            });
          } else {
            token.setPosition(destination.x, destination.y);
          }
          // The camera tails the mover while walking (spec §7).
          this.panCameraTo(token.x, token.y);
        }
      } else if (event.type === 'GoldStolen' && token) {
        coinBurst(this, token, speed);
        await wait(360 * speed);
      } else if (event.type === 'FrenzyStarted') {
        shake(this, speed);
        await wait(220 * speed);
      }
    }
  }

  /** Whole-map button (DOM `map-toggle`) asks the scene to zoom out/in. */
  toggleWholeMap(state: GameState, whole: boolean): void {
    this.wholeMap = whole;
    this.applyCamera(cameraTarget(state, whole, this.cameras.main));
  }

  private applyCamera(target: ReturnType<typeof cameraTarget>): void {
    const camera = this.cameras.main;
    this.tweens.killTweensOf(camera);
    const bounds = cameraBounds(camera, this.wholeMap);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    // Review 7a: honour the target's duration — the camera eases to the
    // active seat at turn start (spec §7); duration 0 snaps (?speed=0 or
    // reduced motion).
    if (target.duration <= 0) {
      camera.setZoom(target.zoom);
      camera.centerOn(target.x, target.y);
      return;
    }
    this.tweens.add({
      targets: camera,
      zoom: target.zoom,
      scrollX: target.x - camera.width * 0.5,
      scrollY: target.y - camera.height * 0.5,
      duration: target.duration,
      ease: 'Sine.easeInOut',
    });
  }

  private panCameraTo(x: number, y: number): void {
    const camera = this.cameras.main;
    if (this.wholeMap) return;
    // Review 7b: Phaser's centerOn is scrollX = x - width*0.5 (zoom is
    // applied about the camera centre). Tween to exactly that — the old
    // width/(2*zoom) formula landed ~71 px off-centre, and the fake
    // GameState built here was dead code.
    if (motionScale() <= 0 || reducedMotion()) {
      camera.centerOn(x, y);
      return;
    }
    this.tweens.add({
      targets: camera,
      scrollX: x - camera.width * 0.5,
      scrollY: y - camera.height * 0.5,
      duration: 200 * motionScale(),
      ease: 'Sine.easeOut',
    });
  }

  private renderBoard(state: GameState): void {
    this.cancelOnlineMovement();
    this.latestState = state;
    // BattleScene covers the stage. Rendering the large map beneath it adds
    // an invisible software-GL pass to every battle frame and DOM interaction.
    // Do this before the signature guard: entering/leaving battle may change
    // no board geometry, but must still hide/restore the board camera.
    this.cameras.main.setVisible(state.phase.kind !== 'battle');
    this.backdropCamera?.setVisible(state.phase.kind !== 'battle');
    this.applyViewports();
    // Combat picks and other nonvisual updates can arrive several times per
    // second. Recreating the entire tiled board for each one overwhelms
    // software-rendered Chromium and starves DOM input on CI machines.
    const signature = JSON.stringify([
      state.config.seed,
      state.turnSeat,
      state.phase.kind === 'chooseBranch' ? state.phase.options : null,
      state.towns.map((town) => [town.spaceId, town.owner, town.value]),
      state.players.map((player) => [player.pos, player.classId, !!player.prank]),
    ]);
    if (signature === this.renderSignature) return;
    this.renderSignature = signature;
    clearForkArrows(this);
    this.children.removeAll(true);
    this.tokenObjects.clear();
    this.spacePositions.clear();
    closeSpaceInfo();

    // Review Focus 2: never render a board from another map.
    if (!validate(state.board)) {
      const legacy = this.game.registry.get('onBoardOutdated') as (() => void) | undefined;
      legacy?.();
      return;
    }

    // Layer 1: painted map background (5×3 WebP tiles, flat fallbacks).
    this.drawPaintedMap();

    // Layer 2: cream road along every `next` edge (map pixels).
    drawRoad(this, roadSegments(state.board));

    // Layer 3: town buildings by value tier, then space tiles.
    const spaceById = new Map(state.board.spaces.map((space) => [space.id, space]));
    // Movement destinations include empty spaces; shared-token offsets below
    // belong only to token placement, never to this authoritative lookup.
    for (const space of state.board.spaces)
      this.spacePositions.set(space.id, { x: space.x, y: space.y });
    drawBuildings(this, state.towns, (spaceId) => {
      const at = spaceById.get(spaceId);
      return at ? { x: at.x, y: at.y } : undefined;
    });
    const owners = new Map<number, number | null>();
    for (const town of state.towns) owners.set(town.spaceId, town.owner);
    drawTiles(this, state.board.spaces, owners, state);

    // Layer 4: hero tokens + selection rings, map-pixel positions.
    const colors = seatColors(state.players.map((player) => player.classId));
    const offsets = tokenLayout(state.players.map((player) => player.pos));
    for (const [playerIndex, player] of state.players.entries()) {
      const space = state.board.spaces.find((candidate) => candidate.id === player.pos);
      if (!space) continue;
      const x = space.x + offsets[playerIndex]!.x;
      const y = space.y + offsets[playerIndex]!.y;
      const token = createHeroToken(this, player.classId, x, y);
      // Review 4: the seat colour is the ring, never the character art.
      this.tokenObjects.set(player.seat, token);
      const ring = this.add.graphics().setDepth(40);
      ring.lineStyle(3, seatTint(colors[playerIndex]!), 1);
      ring.strokeCircle(x, y, 14);
      if (player.seat === state.turnSeat) this.startActiveRing(x, y);
    }

    // Layer 5: fork arrows while a branch choice is pending (Review Focus 3).
    if (state.phase.kind === 'chooseBranch')
      drawForkArrows(this, state, (to) => {
        // DOM and Phaser pointer queues can retain an arrow after a redraw.
        // Accept only the still-pending branch for the same turn and space.
        const latest = this.latestState;
        if (
          latest?.phase.kind !== 'chooseBranch' ||
          latest.turnSeat !== state.turnSeat ||
          latest.players[latest.turnSeat]?.pos !== state.players[state.turnSeat]?.pos ||
          !latest.phase.options.includes(to)
        )
          return;
        this.game.events.emit('board-chooseBranch', to);
      });

    // Layer 6: tween-only ambient life, above tiles below tokens (spec §5).
    drawAmbients(this, state.board.spaces);

    // Tap any space for its info popup (spec §7). One listener total
    // (Review 6a): bindSpaceTaps unbinds before rebinding each render.
    this.latestState = state;
    bindSpaceTaps(
      this,
      () => ({ state: this.latestState as GameState, wholeMap: this.wholeMap }),
      () => this.toggleWholeMap(this.latestState as GameState, false),
    );

    this.applyCamera(cameraTarget(state, this.wholeMap, this.cameras.main));
  }

  private startActiveRing(x: number, y: number): void {
    this.ringTween?.remove();
    const ring = this.add.graphics().setDepth(41);
    ring.lineStyle(3, 0xf5c51c, 1);
    ring.strokeCircle(x, y, 20);
    this.ringTween =
      motionScale() > 0 && !reducedMotion()
        ? this.tweens.add({
            targets: ring,
            scale: 1.15,
            alpha: 0.55,
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          })
        : null;
  }

  /** Turn-start ribbon text (`turn-ribbon` DOM element, rendered by hud.ts). */
  static ribbon(state: GameState): string {
    return t('turn.ribbon', { name: state.players[state.turnSeat]?.name ?? '' });
  }

  /** Zoom used by the E2E tile-size assertion (spec: ≥ 48 CSS px tiles). */
  static gameplayZoom = gameplayZoom;
}

function wait(duration: number): Promise<void> {
  return duration <= 0
    ? Promise.resolve()
    : new Promise((resolve) => window.setTimeout(resolve, duration));
}
