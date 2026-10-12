import Phaser from 'phaser';
import type { GameState, GameEvent } from '@dice-bandits/engine';
import { coinBurst, shake } from '../fx';
import { reducedMotion, motionScale } from '../art/motion';
import { seatColors, seatTint } from '../art/colors';
import {
  createHeroToken,
  createHopPose,
  createRollPose,
  tokenFacing,
  tokenLayout,
} from './board/tokens';
import { createDiePop } from './board/diePop';
import { drawRoad } from './board/road';
import { drawTiles } from './board/tiles';
import { drawBuildings } from './board/buildings';
import { boardViewport, cameraBounds, cameraTarget, gameplayZoom, WORLD } from './board/camera';
import { drawMapLayer, roadSegments, validate } from './board/mapLayer';
import { clearForkArrows, drawForkArrows } from './board/forkArrows';
import { drawAmbients } from './board/ambient';
import { bindSpaceTaps } from './board/spaceTaps';
import { closeSpaceInfo } from '../ui/spaceInfo';
import { createMovementReadout } from '../ui/movementReadout';
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
  private walkCounter?: Phaser.GameObjects.Container;
  private walkCountText?: Phaser.GameObjects.Text;
  private walkCountPill?: Phaser.GameObjects.Graphics;
  private walkPillColor = 0xf5c51c;
  private activeShadow?: Phaser.GameObjects.Ellipse;
  private nameTags = new Map<number, Phaser.GameObjects.Text>();
  private nameTagLifts = new Map<number, number>();
  private localDust = new Map<Phaser.GameObjects.Arc, Phaser.Tweens.Tween>();
  private latestState: GameState | null = null;
  private onlineMovement: ReturnType<typeof createMovementOverlay> | undefined;
  private movementReadout?: ReturnType<typeof createMovementReadout>;
  private rollDie?: ReturnType<typeof createDiePop>;
  private localRevision = 0;
  private staticMovementCommit?: { source: GameState; seat: number; to: number };
  private localWaits = new Set<() => void>();
  private cameraMovement?: Phaser.Tweens.Tween;
  private latestMovementGeneration: number | undefined;
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
      this.cancelLocalMovement();
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
    const destroyReadout = (): void => {
      this.cancelLocalMovement();
      this.movementReadout?.destroy();
      this.movementReadout = undefined;
      this.walkCounter?.destroy();
      this.walkCounter = undefined;
      this.walkCountText = undefined;
      this.walkCountPill = undefined;
      for (const tag of this.nameTags.values()) tag.destroy();
      this.nameTags.clear();
      this.nameTagLifts.clear();
    };
    this.events.once('destroy', () => {
      destroyReadout();
      this.cancelOnlineMovement();
    });
    this.events.once('shutdown', () => {
      destroyReadout();
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
    // Fence lives on the scene, not the disposable overlay. Ignore stale or
    // repeated receipts before they can destroy the current presentation.
    if (generation <= (this.latestMovementGeneration ?? -1)) return;
    this.latestMovementGeneration = generation;
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

  /** Settle every hop/pause on superseding state or exit, without a stale continuation. */
  cancelLocalMovement(): void {
    this.finishLocalMovement(false);
  }

  /** Static feedback has no clock: preserve it only for its own commit. */
  private finishLocalMovement(keepReadout: boolean): void {
    this.staticMovementCommit = undefined;
    this.localRevision = (this.localRevision ?? 0) + 1;
    for (const cancel of this.localWaits ?? []) cancel();
    this.localWaits?.clear();
    this.rollDie?.destroy();
    this.rollDie = undefined;
    this.cameraMovement?.remove();
    this.cameraMovement = undefined;
    this.walkCounter?.setVisible(false).setScale(1);
    if (this.walkCounter) this.tweens.killTweensOf(this.walkCounter);
    for (const [puff, tween] of this.localDust ?? []) {
      tween.remove();
      puff.destroy();
    }
    this.localDust?.clear();
    this.activeShadow?.setScale(1);
    this.walkCountText?.setText('');
    if (!keepReadout) this.movementReadout?.clear();
  }

  async playEvents(
    events: GameEvent[],
    options?: { mode?: 'human' | 'bot'; onStep?: (remaining: number, seat: number) => void },
  ): Promise<void> {
    this.cancelLocalMovement();
    const revision = this.localRevision;
    const current = (): boolean => this.localRevision === revision;
    this.localWaits ??= new Set();
    const previous = this.latestState;
    if (!previous) return;
    const root = this.game.canvas?.closest<HTMLElement>('#app');
    if (root && !this.movementReadout) this.movementReadout = createMovementReadout(root);
    const speed = reducedMotion() ? 0 : Math.max(0, motionScale());
    const seat = events.find((event) => event.type === 'Moved')?.seat;
    const mode =
      options?.mode ??
      (previous.players.find((player) => player.seat === seat)?.control === 'bot'
        ? 'bot'
        : 'human');
    const plan = planMovement(previous, events, mode);
    let segmentIndex = 0;
    let staticEndpoint: { seat: number; to: number } | undefined;
    // Cancellation resolves awaited work as well as removing timers/tweens.
    const pause = (ms: number): Promise<void> => {
      if (ms <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        const finish = (): void => {
          window.clearTimeout(timer);
          this.localWaits.delete(finish);
          resolve();
        };
        const timer = window.setTimeout(finish, ms);
        this.localWaits.add(finish);
      });
    };
    try {
      for (const event of events) {
        if (!current()) return;
        const token = event.seat === null ? undefined : this.tokenObjects.get(event.seat);
        if (event.type === 'DiceRolled' && token) {
          const stopCue = this.startRollCue(token, event, speed, current);
          await pause(350 * speed);
          stopCue();
        } else if (event.type === 'Moved') {
          const segment = plan.segments[segmentIndex];
          if (!segment || event.seat !== segment.seat || event.params.to !== segment.to) continue;
          segmentIndex++;
          const destination = this.spacePositions.get(segment.to);
          if (!token || !destination) continue;
          const facing = tokenFacing(token, destination.x);
          if (speed <= 0 && facing !== token.flipX) token.setFlipX(facing);
          if (segmentIndex === 1 && speed > 0) {
            this.panCameraTo(token.x, token.y, 300 * speed);
            await pause(300 * speed);
            if (!current()) return;
            this.showWalkCounter(token, 0);
          }
          this.panCameraTo(destination.x, destination.y, segment.hopMs * speed);
          if (speed > 0) {
            const startX = token.x,
              startY = token.y;
            const pose = createHopPose(token, destination.x, segment.hopMs);
            const tagLift = token.displayHeight + 4 + (this.nameTagLifts.get(segment.seat) ?? 0);
            const followTag = (): void => {
              this.nameTags.get(segment.seat)?.setPosition(token.x, token.y - tagLift);
              this.walkCounter?.setPosition(token.x, token.y - tagLift - 32);
              this.rollDie?.follow();
            };
            const hop = { progress: 0 };
            await new Promise<void>((resolve) => {
              const handle: { tween?: Phaser.Tweens.Tween } = {};
              let settled = false;
              const finish = (): void => {
                if (settled) return;
                settled = true;
                handle.tween?.remove();
                pose.reset();
                this.activeShadow?.setScale(1);
                followTag();
                this.localWaits.delete(finish);
                resolve();
              };
              handle.tween = this.tweens.add({
                targets: hop,
                progress: 1,
                duration: segment.hopMs * speed,
                ease: 'Linear',
                onUpdate: () => {
                  if (!current()) return;
                  const k = hop.progress;
                  const groundY = startY + (destination.y - startY) * k;
                  token.setPosition(
                    startX + (destination.x - startX) * k,
                    groundY - Math.sin(Math.PI * k) * 26,
                  );
                  pose.update(k);
                  followTag();
                  if (segment.seat === previous.turnSeat)
                    this.activeShadow
                      ?.setPosition(token.x, groundY)
                      .setScale(1 - 0.45 * Math.sin(Math.PI * k));
                },
                onComplete: () => {
                  if (current()) {
                    token.setPosition(destination.x, destination.y);
                    if (token.flipX !== facing) token.setFlipX(facing);
                    if (segment.seat === previous.turnSeat)
                      this.activeShadow?.setPosition(destination.x, destination.y);
                    this.emitWalkDust(destination.x, destination.y, speed);
                  }
                  finish();
                },
              });
              this.localWaits.add(finish);
            });
          } else token.setPosition(destination.x, destination.y);
          if (!current()) return;
          this.movementReadout?.step(segment.remaining, segment.seat, { static: speed === 0 });
          this.applyViewports();
          options?.onStep?.(segment.remaining, segment.seat);
          if (speed > 0) this.showWalkCounter(token, segment.remaining);
          await pause(segment.holdMs * speed);
          if (!current()) return;
          if (segmentIndex === plan.segments.length && plan.landingSpace !== null) {
            await pause((mode === 'human' ? 180 : 0) * speed);
            if (!current()) return;
            this.movementReadout?.land(plan.landingSpace, events, { keepCounter: speed === 0 });
            await pause((mode === 'human' ? 650 : 250) * speed);
          }
        } else if (event.type === 'GoldStolen' && token) {
          coinBurst(this, token, speed);
          await pause(360 * speed);
        } else if (event.type === 'FrenzyStarted') {
          shake(this, speed);
          await pause(220 * speed);
        }
      }
      const last = plan.segments.at(-1);
      if (speed === 0 && last && segmentIndex === plan.segments.length)
        staticEndpoint = { seat: last.seat, to: last.to };
    } finally {
      if (current()) {
        this.finishLocalMovement(!!staticEndpoint);
        if (staticEndpoint) this.staticMovementCommit = { source: previous, ...staticEndpoint };
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

  private panCameraTo(x: number, y: number, duration?: number): void {
    const camera = this.cameras.main;
    if (this.wholeMap) return;
    this.cameraMovement?.remove();
    // Review 7b: Phaser's centerOn is scrollX = x - width*0.5 (zoom is
    // applied about the camera centre). Tween to exactly that — the old
    // width/(2*zoom) formula landed ~71 px off-centre, and the fake
    // GameState built here was dead code.
    if (motionScale() <= 0 || reducedMotion()) {
      camera.centerOn(x, y);
      return;
    }
    this.cameraMovement = this.tweens.add({
      targets: camera,
      scrollX: x - camera.width * 0.5,
      scrollY: y - camera.height * 0.5,
      duration: duration ?? 200 * motionScale(),
      ease: duration === undefined ? 'Sine.easeOut' : 'Sine.easeInOut',
    });
  }

  private renderBoard(state: GameState): void {
    const pending = this.staticMovementCommit;
    // Consume this one-shot receipt before redraw. Later views always clear,
    // even if the endpoint is unchanged. Battle/exit never retain feedback.
    const ownStaticCommit =
      !!pending &&
      pending.source === this.latestState &&
      state.config.seed === pending.source.config.seed &&
      state.players.find((player) => player.seat === pending.seat)?.pos === pending.to &&
      state.phase.kind !== 'battle' &&
      state.phase.kind !== 'gameOver';
    this.finishLocalMovement(ownStaticCommit);
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
    // The scene-owned pill is not part of the redrawable board geometry.
    if (this.walkCounter) this.children.remove(this.walkCounter);
    this.children.removeAll(true);
    if (this.walkCounter) this.children.add(this.walkCounter);
    this.activeShadow = undefined;
    this.tokenObjects.clear();
    this.nameTags.clear();
    this.nameTagLifts.clear();
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
      if (player.seat === state.turnSeat) {
        token.setDepth(36).setScale(token.scaleX * 1.18, token.scaleY * 1.18);
        this.activeShadow = this.add
          .ellipse(x, y, 48, 16, 0x3a1f0d, 0.22)
          .setDepth(29)
          .setName('active-token-shadow');
      }
      let lift =
        offsets[playerIndex]!.x !== 0 ||
        state.players.filter((p) => p.pos === player.pos).length > 1
          ? (playerIndex % 2) * 24
          : 0;
      const tag = this.add
        .text(x, y - token.displayHeight - 4 - lift, player.name, {
          fontFamily: getComputedStyle(document.documentElement).fontFamily,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#3a1f0d',
          strokeThickness: 3,
          backgroundColor: colors[playerIndex]!,
          padding: { x: 8, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(player.seat === state.turnSeat ? 45 : 44)
        .setName(`hero-name-${player.seat}`);
      // Pack full labels using their rendered stroke/padding dimensions, not
      // fixed-height rows. Prefer the alternating height, then a free row above
      // or below it, bounded by the map top and this hero's head.
      const initial = tag.getBounds();
      const height = initial.bottom - initial.top;
      const halfWidth = (initial.right - initial.left) / 2;
      const tagX = Math.max(halfWidth, Math.min(WORLD.width - halfWidth, x));
      const lowest = Math.min(WORLD.height, token.getBounds().top - 4);
      const previous = [...this.nameTags.values()].map((other) => other.getBounds());
      const candidates = [
        initial.bottom,
        ...previous.flatMap((other) => [other.top - 4, other.bottom + height + 4]),
        lowest,
        height,
      ]
        .map((bottom) => Math.max(height, Math.min(lowest, bottom)))
        .sort((a, b) => Math.abs(a - initial.bottom) - Math.abs(b - initial.bottom));
      for (const bottom of candidates) {
        tag.setPosition(tagX, bottom);
        const bounds = tag.getBounds();
        if (
          previous.every(
            (other) =>
              bounds.left >= other.right ||
              bounds.right <= other.left ||
              bounds.top >= other.bottom ||
              bounds.bottom <= other.top,
          )
        )
          break;
      }
      lift = y - token.displayHeight - 4 - tag.y;
      this.nameTagLifts.set(player.seat, lift);
      this.nameTags.set(player.seat, tag);
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

  /** Shares the existing roll pause; its reset is owned alongside local waits. */
  private startRollCue(
    token: Phaser.GameObjects.Image,
    event: GameEvent,
    speed: number,
    current: () => boolean,
  ): () => void {
    if (speed <= 0 || reducedMotion()) return () => {};
    this.rollDie?.destroy();
    this.rollDie = createDiePop(
      this,
      token,
      () => this.nameTags.get(event.seat ?? -1),
      event,
      speed,
    );
    const pose = createRollPose(token);
    const tag = this.nameTags.get(event.seat ?? -1);
    const lift = tag ? token.y - tag.y : 0;
    const progress = { roll: 0 };
    let alive = true;
    const follow = (): void => {
      tag?.setPosition(token.x, token.y - lift);
      this.rollDie?.follow();
    };
    const stop = (): void => {
      if (!alive) return;
      alive = false;
      tween?.remove();
      pose.reset();
      follow();
      this.localWaits.delete(stop);
    };
    this.localWaits.add(stop);
    const tween = this.tweens.add({
      targets: progress,
      roll: 1,
      duration: 350 * speed,
      ease: 'Linear',
      onUpdate: () => {
        if (!alive || !current()) return;
        pose.update(progress.roll);
        follow();
      },
      onComplete: stop,
    });
    return stop;
  }

  /** One scene-owned pill, retained through redraws and hidden on cancellation. */
  private showWalkCounter(token: Phaser.GameObjects.Image, remaining: number): void {
    if (!this.walkCounter) {
      const theme = getComputedStyle(document.documentElement);
      const cocoa = theme.getPropertyValue('--c-cocoa').trim() || '#5c3317';
      const gold = theme.getPropertyValue('--c-gold').trim() || '#f5c51c';
      const font = getComputedStyle(document.documentElement).fontFamily;
      this.walkCountText = this.add
        .text(0, -2, '', {
          fontFamily: font,
          fontSize: '30px',
          fontStyle: 'bold',
          color: cocoa,
        })
        .setOrigin(0.5, 1);
      this.walkCountPill = this.add.graphics();
      this.walkCounter = this.add
        .container(0, 0, [this.walkCountPill, this.walkCountText])
        .setName('walk-counter')
        .setDepth(60)
        .setVisible(false);
      this.walkPillColor = Number.parseInt(gold.replace('#', ''), 16);
    }
    const nextText = remaining > 0 ? String(remaining) : '';
    const changed = this.walkCountText!.text !== nextText;
    this.walkCountText!.setText(nextText);
    const width = this.walkCountText!.displayWidth + 24;
    const height = this.walkCountText!.height + 4;
    this.walkCountPill!.clear()
      .fillStyle(this.walkPillColor, 1)
      .fillRoundedRect(-width / 2, -height, width, height, height / 2);
    const seat = [...this.tokenObjects].find(([, hero]) => hero === token)?.[0];
    const tagLift = seat === undefined ? 0 : (this.nameTagLifts.get(seat) ?? 0);
    this.walkCounter
      .setPosition(token.x, token.y - token.displayHeight - 36 - tagLift)
      .setVisible(remaining > 0);
    if (!this.walkCounter.visible || motionScale() <= 0 || reducedMotion()) {
      this.tweens.killTweensOf(this.walkCounter);
      this.walkCounter.setScale(1);
    } else if (changed) {
      this.tweens.killTweensOf(this.walkCounter);
      this.walkCounter.setScale(1.4);
      this.tweens.add({ targets: this.walkCounter, scale: 1, duration: 220, ease: 'Back.easeOut' });
    }
  }

  /** Owned nonblocking landing dust. Old completion callbacks cannot destroy
   * a replacement effect or create anything after cancellation. */
  private emitWalkDust(x: number, y: number, speed: number): void {
    for (let d = 0; d < 8; d++) {
      const angle = (Math.PI * 2 * d) / 8;
      const puff = this.add
        .circle(x, y - 4, 10, 0xfff3d6, 1)
        .setStrokeStyle(2, 0xb89a6a, 0.9)
        .setDepth(37)
        .setName('walk-dust');
      const tween = this.tweens.add({
        targets: puff,
        x: x + Math.cos(angle) * 44,
        y: y - 6 + Math.sin(angle) * 14,
        alpha: 0,
        scale: 2,
        duration: 520 * speed,
        ease: 'Quad.easeOut',
        onComplete: () => {
          if (this.localDust.delete(puff)) puff.destroy();
        },
      });
      this.localDust.set(puff, tween);
    }
  }

  /** Turn-start ribbon text (`turn-ribbon` DOM element, rendered by hud.ts). */
  static ribbon(state: GameState): string {
    return t('turn.ribbon', { name: state.players[state.turnSeat]?.name ?? '' });
  }

  /** Zoom used by the E2E tile-size assertion (spec: ≥ 48 CSS px tiles). */
  static gameplayZoom = gameplayZoom;
}
