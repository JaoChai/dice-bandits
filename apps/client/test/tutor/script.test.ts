import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chooseAction,
  createGame,
  legalActions,
  nextFloat,
  seedRng,
  step,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { TUTORIAL_SCRIPT, type TutorialScript } from '../../src/tutor/script';
import { planMovement } from '../../src/scenes/board/movementPlan';
import { planBattle } from '../../src/scenes/battle/presentation';

const config: GameConfig = {
  seed: 'tutorial-validator',
  rounds: 12,
  seats: [
    { name: 'Learner', classId: 'mage', control: 'human', personality: null },
    { name: 'Bandit', classId: 'thief', control: 'bot', personality: 'cowardly' },
  ],
};

const topics = ['roll', 'move', 'fork', 'chest', 'battle', 'shop', 'town', 'steal'] as const;
type Topic = (typeof topics)[number];
type Entry = { seat: number; action: Action };
type Lesson = {
  topic: Topic;
  replayIndex: number;
  beforePhase: GameState['phase']['kind'];
  suggested: Action;
};
type Frame = { before: GameState; after: GameState; events: GameEvent[] };

function sameAction(a: Action, b: Action): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => b[key as keyof Action] === value)
  );
}

function applyEntry(state: GameState, entry: Entry, index: number): Frame {
  if (!legalActions(state, entry.seat).some((action) => sameAction(action, entry.action))) {
    throw new Error(`illegal replay at ${index}: seat ${entry.seat}`);
  }
  if (
    state.players[entry.seat]!.control === 'bot' &&
    !sameAction(entry.action, chooseAction(state, entry.seat))
  ) {
    throw new Error(`bot policy mismatch at ${index}`);
  }
  const result = step(state, entry.action);
  return { before: state, after: result.state, events: result.events };
}

function validateReplay(gameConfig: GameConfig, replay: Entry[]): Frame[] {
  let state = createGame(gameConfig);
  return replay.map((entry, index) => {
    const frame = applyEntry(state, entry, index);
    state = frame.after;
    return frame;
  });
}

function validateScript(script: TutorialScript): Frame[] {
  const frames = validateReplay(script.config, script.replay);
  if (script.lessons.map((lesson) => lesson.topic).join(',') !== topics.join(',')) {
    throw new Error('curriculum order mismatch');
  }
  let previousIndex = -1;
  for (const lesson of script.lessons) {
    const entry = script.replay[lesson.replayIndex];
    const frame = frames[lesson.replayIndex];
    if (
      !Number.isInteger(lesson.replayIndex) ||
      lesson.replayIndex < previousIndex ||
      !entry ||
      !frame ||
      script.config.seats[entry.seat]?.control !== 'human' ||
      frame.before.phase.kind !== lesson.beforePhase ||
      !sameAction(entry.action, lesson.suggested) ||
      !legalActions(frame.before, entry.seat).some((action) =>
        sameAction(action, lesson.suggested),
      ) ||
      !milestones(frame, entry).includes(lesson.topic)
    ) {
      throw new Error(`invalid lesson ${lesson.topic}`);
    }
    previousIndex = lesson.replayIndex;
  }
  return frames;
}

function hash(state: GameState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function milestones(frame: Frame, entry: Entry): Topic[] {
  if (entry.seat !== 0) return [];
  const has = (type: string) =>
    frame.events.some((event) => event.type === type && event.seat === 0);
  return [
    ...(has('DiceRolled') ? ['roll' as const] : []),
    ...(has('Moved') ? ['move' as const] : []),
    ...(entry.action.type === 'chooseBranch' && has('BranchChosen') ? ['fork' as const] : []),
    ...(frame.after.board.spaces[frame.after.players[0]!.pos]!.kind === 'chest' &&
    has('Moved') &&
    (has('GoldGained') || has('ItemFound'))
      ? ['chest' as const]
      : []),
    ...(frame.before.phase.kind === 'battle' && entry.action.type === 'battlePick'
      ? ['battle' as const]
      : []),
    ...(frame.before.phase.kind === 'shop' && has('ItemBought') ? ['shop' as const] : []),
    ...(has('TownClaimed') ? ['town' as const] : []),
    ...(entry.action.type === 'pvpReward' &&
    entry.action.reward === 'rob' &&
    frame.events.some(
      (event) => event.type === 'GoldStolen' && event.seat === 0 && Number(event.params.amount) > 0,
    )
      ? ['steal' as const]
      : []),
  ];
}

// Opt-in only: normal gates replay frozen data, never perform a fresh search.
it.skipIf(process.env.TUTOR_SEARCH !== '1')(
  'bounded seed and human-choice search',
  () => {
    const started = performance.now();
    const ledgerPath = join(process.env.TMPDIR!, 'm8-route-search.jsonl');
    const ledger: Array<{ elapsedMs: number }> = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    // Six exploratory invocations before the ledger existed took at most 126.25 s
    // INCLUDING Vitest startup. Charge that conservative upper bound too.
    const spentMs = 126_250 + ledger.reduce((sum, entry) => sum + entry.elapsedMs, 0);
    const timeLimitMs = Math.min(180_000, 1_200_000 - spentMs);
    if (timeLimitMs <= 0) throw new Error('20-minute cumulative search budget exhausted');
    let statesTried = 0;
    let trajectoriesTried = 0;
    let seedsTried = 0;
    let best: { topics: Topic[]; decisions: number; seed: string } = {
      topics: [],
      decisions: 0,
      seed: '',
    };
    let candidate: unknown;
    const refine = process.env.TUTOR_REFINE === '1';
    outer: for (
      let seedIndex = refine ? 66918 : 14099;
      seedIndex < (refine ? 66919 : 200_000);
      seedIndex++
    ) {
      seedsTried++;
      for (let policy = 0; policy < 12; policy++) {
        if (performance.now() - started >= timeLimitMs) break outer;
        trajectoriesTried++;
        const gameConfig: GameConfig = { ...config, seed: `m8-route-${seedIndex}` };
        let state = createGame(gameConfig);
        let rng = seedRng(`${gameConfig.seed}:human-policy:${policy}`);
        const replay: Entry[] = [];
        const frames: Frame[] = [];
        const lessons: Lesson[] = [];
        let decisions = 0;
        let humanMoves = 0;
        for (let index = 0; index < 160 && state.phase.kind !== 'gameOver'; index++) {
          if (performance.now() - started >= timeLimitMs) break outer;
          const actor = state.players.find(
            (player) => legalActions(state, player.seat).length > 0,
          )!;
          const actions = legalActions(state, actor.seat);
          let action: Action;
          if (actor.control === 'bot') action = chooseAction(state, actor.seat);
          else {
            if (decisions >= 35) break;
            decisions++;
            const [draw, next] = nextFloat(rng);
            rng = next;
            switch (state.phase.kind) {
              case 'battle': {
                const picks = actions.filter((option) => option.type === 'battlePick');
                const forceStrike = refine && state.phase.battle.context === 'pvp';
                action =
                  picks.find(
                    (option) => option.type === 'battlePick' && option.pick === 'secret',
                  ) ??
                  picks.find(
                    (option) =>
                      option.type === 'battlePick' &&
                      option.pick ===
                        (forceStrike || draw < (policy % 3) / 3 ? 'strike' : 'attack'),
                  ) ??
                  picks[0]!;
                break;
              }
              case 'shop':
                action =
                  !lessons.some((lesson) => lesson.topic === 'shop') &&
                  lessons.some((lesson) => lesson.topic === 'battle')
                    ? (actions.find((option) => option.type === 'shopBuy') ??
                      actions.find((option) => option.type === 'leave')!)
                    : actions.find((option) => option.type === 'leave')!;
                break;
              case 'duelOffer':
                action = lessons.some((lesson) => lesson.topic === 'town')
                  ? actions.find((option) => option.type === 'duel' && option.target !== null)!
                  : actions[0]!;
                break;
              case 'pvpReward':
                action = actions.find(
                  (option) => option.type === 'pvpReward' && option.reward === 'rob',
                )!;
                break;
              case 'townManage':
              case 'townChallenge':
                action = actions.find((option) => option.type === 'leave')!;
                break;
              case 'levelUp':
                action =
                  (refine
                    ? (actions.find(
                        (option) => option.type === 'pickPerk' && option.perk === 'magUp',
                      ) ??
                      actions.find(
                        (option) => option.type === 'pickPerk' && option.perk === 'atkUp',
                      ))
                    : undefined) ?? actions[0]!;
                break;
              case 'chooseBranch':
                action = actions[Math.floor(draw * actions.length)]!;
                break;
              default:
                action = actions[0]!;
            }
          }
          const entry = { seat: actor.seat, action };
          const frame = applyEntry(state, entry, index);
          statesTried++;
          replay.push(entry);
          frames.push(frame);
          for (const topic of milestones(frame, entry)) {
            if (topic === topics[lessons.length])
              lessons.push({
                topic,
                replayIndex: index,
                beforePhase: state.phase.kind,
                suggested: action,
              });
          }
          humanMoves += frame.events.filter(
            (event) => event.type === 'Moved' && event.seat === 0,
          ).length;
          state = frame.after;
          if (lessons.length > best.topics.length)
            best = {
              topics: lessons.map((lesson) => lesson.topic),
              decisions,
              seed: gameConfig.seed,
            };
          const introduced = new Set(lessons.map((lesson) => lesson.topic));
          const prematureHumanTopic =
            entry.seat === 0 &&
            ((frame.after.phase.kind === 'battle' && !introduced.has('chest')) ||
              (frame.after.phase.kind === 'shop' && !introduced.has('battle')) ||
              (milestones(frame, entry).includes('chest') && !introduced.has('fork')) ||
              (milestones(frame, entry).includes('town') && !introduced.has('shop')));
          if (
            prematureHumanTopic ||
            frame.events.some((event) => event.type === 'PlayerKO' && event.seat === 0) ||
            humanMoves > 34
          )
            break;
          if (lessons.length === topics.length) {
            candidate = {
              script: { id: 'm8-route-v1', config: gameConfig, replay, lessons },
              policy,
              decisions,
              humanMoves,
              hashes: [hash(createGame(gameConfig)), ...frames.map((item) => hash(item.after))],
              trace: frames.map((item, i) => ({
                index: i,
                seat: replay[i]!.seat,
                action: replay[i]!.action,
                round: item.before.round,
                pos: item.after.players[0]!.pos,
                hp: item.after.players[0]!.hp,
                phase: item.before.phase.kind,
                events: item.events,
              })),
            };
            break outer;
          }
        }
      }
    }
    const search = {
      refine,
      seedsTried,
      trajectoriesTried,
      statesTried,
      elapsedMs: performance.now() - started,
      best,
    };
    appendFileSync(ledgerPath, `${JSON.stringify(search)}\n`);
    console.log('SEARCH', JSON.stringify(search));
    if (candidate) {
      const output = join(process.env.TMPDIR!, 'm8-route-candidate.json');
      writeFileSync(output, JSON.stringify({ search, candidate }, null, 2));
      console.log('CANDIDATE', output);
      const found = (candidate as { script: TutorialScript }).script;
      validateScript(found);
      if (refine) expect(found).toEqual(TUTORIAL_SCRIPT);
    }
    expect(candidate, JSON.stringify(search)).toBeDefined();
  },
  190_000,
);

describe('tutorial replay validator', () => {
  it('rejects a desynchronised seat even when the action payload is legal for another seat', () => {
    expect(() => validateReplay(config, [{ seat: 1, action: { type: 'roll' } }])).toThrow(
      'illegal replay at 0: seat 1',
    );
  });

  it('rejects illegal action payloads, including battlePick despite the step exemption', () => {
    const illegal = structuredClone(TUTORIAL_SCRIPT);
    illegal.replay[4]!.action = { type: 'chooseBranch', to: 999 };
    expect(() => validateScript(illegal)).toThrow('illegal replay at 4');
    const battle = structuredClone(TUTORIAL_SCRIPT);
    battle.replay[21]!.action = { type: 'battlePick', side: 'b', pick: 'secret' };
    expect(() => validateScript(battle)).toThrow('illegal replay at 21');
  });

  it('rejects a legal but noncanonical bot choice', () => {
    const changed = structuredClone(TUTORIAL_SCRIPT);
    changed.replay[1]!.action = { type: 'roll' };
    expect(() => validateScript(changed)).toThrow('bot policy mismatch at 1');
  });

  it.each(['index', 'phase', 'suggestion', 'topic', 'event', 'bot lesson'])(
    'rejects desynchronised lesson metadata: %s',
    (field) => {
      const changed = structuredClone(TUTORIAL_SCRIPT);
      const lesson = changed.lessons[2]!;
      if (field === 'index') lesson.replayIndex = -1;
      if (field === 'phase') lesson.beforePhase = 'shop';
      if (field === 'suggestion') lesson.suggested = { type: 'chooseBranch', to: 11 };
      if (field === 'topic') lesson.topic = 'shop';
      if (field === 'event') {
        lesson.replayIndex = 3;
        lesson.beforePhase = 'awaitRoll';
        lesson.suggested = { type: 'roll' };
      }
      if (field === 'bot lesson') {
        lesson.replayIndex = 1;
        lesson.beforePhase = 'awaitRoll';
        lesson.suggested = changed.replay[1]!.action;
      }
      expect(() => validateScript(changed)).toThrow();
    },
  );
});

describe('frozen ordinary-engine tutorial route', () => {
  it('replays all 67 actions legally and matches every one of the 36 deterministic bot choices', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    expect(frames).toHaveLength(67);
    expect(TUTORIAL_SCRIPT.config.seats.map((seat) => seat.control)).toEqual(['human', 'bot']);
    expect(TUTORIAL_SCRIPT.replay.filter((entry) => entry.seat === 1)).toHaveLength(36);
    expect(validateScript(TUTORIAL_SCRIPT)).toEqual(frames);
    // The data includes no state snapshots/overrides or alternate starting checkpoint.
    expect(Object.keys(TUTORIAL_SCRIPT).sort()).toEqual(['config', 'id', 'lessons', 'replay']);
  });

  it('pins the initial, every intermediate, and final state via a SHA-256 chain', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    const hashes = [
      hash(createGame(TUTORIAL_SCRIPT.config)),
      ...frames.map((frame) => hash(frame.after)),
    ];
    expect(hashes[0]).toBe('2e99e7f76012cf80418cd57ba8f62f0487a7dcfc52147d07b9cbe462648acccb');
    expect(hashes.at(-1)).toBe('4efe0d322813ce023b0c15c2149bdb040c5b6731f7a3e476ea2b5439245d8caf');
    expect(createHash('sha256').update(hashes.join('\n')).digest('hex')).toBe(
      'bcb7b0882800e7ac1ee33a43f050871391427b576ad7d028fdb38859066e15ed',
    );
  });

  it('does not mutate any input state or the frozen script during replay', () => {
    const original = JSON.stringify(TUTORIAL_SCRIPT);
    let state = createGame(TUTORIAL_SCRIPT.config);
    for (const [index, entry] of TUTORIAL_SCRIPT.replay.entries()) {
      const before = hash(state);
      const frame = applyEntry(state, entry, index);
      expect(hash(state)).toBe(before);
      state = frame.after;
    }
    expect(JSON.stringify(TUTORIAL_SCRIPT)).toBe(original);
  });

  it('covers eight human milestones in teaching order, with actual event order for shared actions', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    expect(TUTORIAL_SCRIPT.lessons.map((lesson) => lesson.topic)).toEqual(topics);
    expect(TUTORIAL_SCRIPT.lessons.map((lesson) => lesson.replayIndex)).toEqual([
      0, 0, 4, 4, 21, 29, 38, 66,
    ]);
    const introduced = new Set<Topic>();
    for (const [index, frame] of frames.entries()) {
      for (const lesson of TUTORIAL_SCRIPT.lessons.filter((item) => item.replayIndex === index)) {
        expect(milestones(frame, TUTORIAL_SCRIPT.replay[index]!)).toContain(lesson.topic);
        introduced.add(lesson.topic);
      }
      if (TUTORIAL_SCRIPT.replay[index]!.seat !== 0) continue;
      if (frame.after.phase.kind === 'battle') expect(introduced.has('chest')).toBe(true);
      if (frame.after.phase.kind === 'shop') expect(introduced.has('battle')).toBe(true);
      if (milestones(frame, TUTORIAL_SCRIPT.replay[index]!).includes('chest'))
        expect(introduced.has('fork')).toBe(true);
      if (milestones(frame, TUTORIAL_SCRIPT.replay[index]!).includes('town'))
        expect(introduced.has('shop')).toBe(true);
    }
    const firstEvents = frames[0]!.events.map((event) => event.type);
    expect(firstEvents.indexOf('DiceRolled')).toBeLessThan(firstEvents.indexOf('Moved'));
    const forkEvents = frames[4]!.events.map((event) => event.type);
    expect(forkEvents.indexOf('BranchChosen')).toBeLessThan(forkEvents.indexOf('GoldGained'));
  });

  it('really buys equipment, claims town 27, wins PvP, and robs the bot for 15 gold', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    const purchase = frames[29]!;
    expect(purchase.events).toContainEqual({
      type: 'ItemBought',
      seat: 0,
      params: { item: 'crystalWand', price: 400 },
    });
    expect(purchase.after.players[0]!.weapon).toBe('crystalWand');
    expect(purchase.before.players[0]!.gold - purchase.after.players[0]!.gold).toBe(400);
    const town = frames[38]!;
    expect(town.before.towns.find((item) => item.spaceId === 27)!.owner).toBeNull();
    expect(town.after.towns.find((item) => item.spaceId === 27)!.owner).toBe(0);
    expect(town.events).toContainEqual({
      type: 'TownClaimed',
      seat: 0,
      params: { spaceId: 27, previousOwner: -1 },
    });
    expect(frames[65]!.events).toContainEqual({
      type: 'BattleEnded',
      seat: 0,
      params: { result: 'aWin' },
    });
    const robbery = frames[66]!;
    expect(robbery.before.phase).toEqual({ kind: 'pvpReward', winner: 0, loser: 1 });
    expect(robbery.events).toContainEqual({ type: 'GoldStolen', seat: 0, params: { amount: 15 } });
    // End-turn taxes happen in the same engine step; do not confuse them with robbery.
    expect(robbery.after.stats.robbedGold[0]! - robbery.before.stats.robbedGold[0]!).toBe(15);
    expect(robbery.after.players[0]!.gold - robbery.before.players[0]!.gold).toBe(15 + 24);
    expect(robbery.after.players[1]!.gold - robbery.before.players[1]!.gold).toBe(-15 + 20);
  });

  it('uses 31 human decisions and 25 distinct walking steps, no human KO or skipped turn', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    const humanEvents = frames.flatMap((frame) => frame.events).filter((event) => event.seat === 0);
    const steps = humanEvents.filter((event) => event.type === 'Moved');
    expect(TUTORIAL_SCRIPT.replay.filter((entry) => entry.seat === 0)).toHaveLength(31);
    expect(steps).toHaveLength(25);
    expect(new Set(steps.map((event) => event.params.to)).size).toBe(25);
    expect(humanEvents.some((event) => ['PlayerKO', 'TurnSkipped'].includes(event.type))).toBe(
      false,
    );
    expect(frames.every((frame) => frame.after.players[0]!.hp > 0)).toBe(true);
    expect(frames.at(-1)!.after.players[0]!.hp).toBe(25);
    expect(frames.at(-1)!.before.round).toBe(8);
    expect(frames.some((frame) => frame.after.phase.kind === 'gameOver')).toBe(false);
  });

  it('records speed-1 presentation budgets from real replay frames, not fabricated battles', () => {
    const frames = validateScript(TUTORIAL_SCRIPT);
    let walkMs = 0;
    let arrivalMs = 0;
    let diceMs = 0;
    let battleMs = 0;
    let robberyMs = 0;
    let humanBattleSteps = 0;
    let botBattleSteps = 0;
    for (const frame of frames) {
      const mover = frame.events.find((event) => event.type === 'Moved')?.seat;
      const mode = mover === 1 ? 'bot' : 'human';
      const movement = planMovement(frame.before, frame.events, mode);
      walkMs += movement.segments.reduce((sum, segment) => sum + segment.hopMs + segment.holdMs, 0);
      if (movement.landingSpace !== null) arrivalMs += mode === 'human' ? 180 + 650 : 250;
      for (const event of frame.events) {
        if (event.type === 'DiceRolled') diceMs += 350 + (event.seat === 0 ? 2300 : 0);
        if (event.type === 'GoldStolen') robberyMs += 360;
      }
      const humanBattle =
        frame.before.phase.kind === 'battle' &&
        [frame.before.phase.battle.a, frame.before.phase.battle.b].some(
          (actor) => actor.kind === 'player' && actor.seat === 0,
        );
      const beats = planBattle(
        frame.before,
        frame.after,
        frame.events,
        humanBattle ? 'human' : 'bot',
        false,
      );
      if (beats.length) {
        if (humanBattle) humanBattleSteps++;
        else botBattleSteps++;
      }
      battleMs += beats.reduce((sum, beat) => sum + beat.duration * (humanBattle ? 1 : 0.9), 0);
    }
    const botPauseMs = 36 * 100;
    const stats = {
      walkMs,
      arrivalMs,
      diceMs,
      battleMs,
      robberyMs,
      botPauseMs,
      humanBattleSteps,
      botBattleSteps,
    };
    console.log('SPEED_1_ESTIMATE', JSON.stringify(stats));
    expect(stats).toEqual({
      walkMs: 14_800,
      arrivalMs: 6_730,
      diceMs: 23_650,
      battleMs: 23_203.8,
      robberyMs: 360,
      botPauseMs: 3_600,
      humanBattleSteps: 9,
      botBattleSteps: 6,
    });
    expect(walkMs + arrivalMs + diceMs + battleMs + robberyMs + botPauseMs).toBeCloseTo(
      72_343.8,
      3,
    );
  });
});
