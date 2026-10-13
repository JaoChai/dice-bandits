import {
  data,
  legalActions,
  type Action,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { getLang, t } from '../i18n';
import type { IconName } from './artFrames';

export type PostResult = {
  winner: 'a' | 'b' | null;
  seat: number | null;
  winnerName: string;
  loserName: string;
  gold: number;
  xp: number;
  fromGold: number;
  toGold: number;
  fromLevel: number;
  nextXpGoal: number;
  fromXp: number;
  toXp: number;
  xpGoal: number;
  level: number;
  pending: boolean;
};
export type PostChoice = {
  action: Action;
  icon: IconName | 'heart' | 'crown';
  name: string;
  detail: string;
  equipped: boolean;
  group: 'perk' | 'gold' | 'item' | 'town' | 'prank';
  amount?: number;
};

export const POST_STRINGS = {
  win: ['ชนะ!', 'Victory!'],
  lose: ['แพ้…', 'Defeated…'],
  draw: ['เสมอ!', 'A draw!'],
  reward: ['รางวัลจากการต่อสู้', 'Battle rewards'],
  xp: ['ค่าประสบการณ์', 'Experience'],
  level: ['เลเวลอัป!', 'Level up!'],
  choose: ['เลือกความสามารถใหม่ 1 อย่าง', 'Choose one new perk'],
  bag: ['กระเป๋าของ', 'Bag of'],
  loot: ['เลือกชิงได้ 1 อย่าง', 'Take one reward'],
  equipped: ['สวมอยู่', 'Equipped'],
  waitPrefix: ['รอ ', 'Waiting for '],
  waitSuffix: [' เลือก…', ' to choose…'],
  takePrefix: [' เอา ', ' took '],
  takeSuffix: [' ไป', ''],
  backBag: ['กลับไปดูกระเป๋า', 'Back to bag'],
  waiting: ['กำลังเลือก…', 'is choosing…'],
  taken: ['ได้รับ', 'Received'],
  skip: ['แตะเพื่อข้ามจังหวะนี้', 'Tap to finish this beat'],
  gold: ['ทอง', 'gold'],
  town: ['เมือง', 'Town'],
  prank: ['แกล้งเปลี่ยนชื่อ 3 รอบ', 'Rename for 3 rounds'],
  perks: ['ความสามารถใหม่', 'New perk'],
  empty: ['ไม่มีสิ่งของหรือเมืองให้ชิง', 'No items or towns to take'],
  browse: ['ดูชื่อที่ใช้แกล้ง', 'Choose a prank name'],
  hpUp: ['พลังชีวิตสูงสุด +10', 'Max HP +10'],
  atkUp: ['พลังโจมตี +3', 'Attack +3'],
  defUp: ['พลังป้องกัน +3', 'Defence +3'],
  spdUp: ['ความเร็ว +3', 'Speed +3'],
  magUp: ['พลังเวท +3', 'Magic +3'],
  taxman: ['เก็บภาษีเพิ่ม 20%', 'Tax income +20%'],
  looter: ['ปล้นทองได้ 40%', 'Rob 40% of gold'],
  thickSkin: ['รับดาเมจมอนสเตอร์น้อยลง 15%', 'Monster damage −15%'],
  quickFeet: ['ทอยได้ 1 เดินเพิ่ม 1 ช่อง', 'Roll 1: move one extra space'],
  haggler: ['ซื้อของถูกลง 15%', 'Shop prices −15%'],
  scavenger: ['ทองจากหีบเพิ่ม 50%', 'Chest gold +50%'],
  grudgeHolder: ['โจมตีผู้นำแรงขึ้น 15%', 'Damage against the leader +15%'],
} as const;
export function postText(key: keyof typeof POST_STRINGS): string {
  return POST_STRINGS[key][getLang() === 'th' ? 0 : 1];
}

export function postResult(
  previous: GameState,
  next: GameState,
  events: GameEvent[],
): PostResult | null {
  const ended = events.find((event) => event.type === 'BattleEnded');
  if (!ended || previous.phase.kind !== 'battle') return null;
  const winner = ended.params.result === 'aWin' ? 'a' : ended.params.result === 'bWin' ? 'b' : null;
  const battle = previous.phase.battle;
  const combatant = winner ? battle[winner] : null;
  const loser = winner ? battle[winner === 'a' ? 'b' : 'a'] : null;
  const seat = combatant?.seat ?? null;
  const name = (fighter: typeof combatant): string =>
    !fighter
      ? ''
      : fighter.kind === 'player'
        ? previous.players[fighter.seat!]!.name
        : t(`monster.${fighter.monsterId}`);
  const amount = (type: string): number =>
    events
      .filter((event) => event.type === type && event.seat === seat)
      .reduce((sum, event) => sum + Number(event.params.amount ?? 0), 0);
  return {
    winner,
    seat,
    winnerName: name(combatant),
    loserName: name(loser),
    gold: amount('GoldGained'),
    xp: amount('XpGained'),
    fromGold: seat === null ? 0 : previous.players[seat]!.gold,
    toGold: seat === null ? 0 : next.players[seat]!.gold,
    fromLevel: seat === null ? 0 : previous.players[seat]!.level,
    nextXpGoal:
      seat === null
        ? 1
        : (data.BALANCE.xpToLevel[next.players[seat]!.level] ?? next.players[seat]!.xp),
    fromXp: seat === null ? 0 : previous.players[seat]!.xp,
    toXp: seat === null ? 0 : next.players[seat]!.xp,
    xpGoal:
      seat === null
        ? 1
        : (data.BALANCE.xpToLevel[previous.players[seat]!.level] ?? next.players[seat]!.xp),
    level: seat === null ? 0 : next.players[seat]!.level,
    pending: next.phase.kind === 'levelUp' || next.phase.kind === 'pvpReward',
  };
}
export function postChoices(state: GameState): PostChoice[] {
  if (state.phase.kind !== 'levelUp' && state.phase.kind !== 'pvpReward') return [];
  const actor = state.phase.kind === 'levelUp' ? state.phase.seat : state.phase.winner;
  return legalActions(state, actor).flatMap((action): PostChoice[] => {
    if (action.type === 'pickPerk') {
      const icon: PostChoice['icon'] =
        action.perk === 'hpUp'
          ? 'heart'
          : action.perk === 'defUp' || action.perk === 'thickSkin'
            ? 'shield'
            : action.perk === 'atkUp'
              ? 'sword'
              : ['taxman', 'looter', 'haggler', 'scavenger'].includes(action.perk)
                ? 'coin'
                : 'star';
      return [
        {
          action,
          icon,
          name: t(`perk.${action.perk}`),
          detail: postText(action.perk as keyof typeof POST_STRINGS),
          equipped: false,
          group: 'perk',
        },
      ];
    }
    if (action.type !== 'pvpReward' || state.phase.kind !== 'pvpReward') return [];
    const target = state.players[state.phase.loser]!;
    if (action.reward === 'rob') {
      const pct = state.players[actor]!.perks.includes('looter')
        ? data.BALANCE.looterRobPct
        : data.BALANCE.robPct;
      const amount = Math.floor((target.gold * pct) / 100);
      return [
        {
          action,
          icon: 'coin',
          name: `${amount} ${postText('gold')}`,
          detail: `${pct}% · ${target.gold} ${postText('gold')}`,
          equipped: false,
          group: 'gold',
          amount,
        },
      ];
    }
    if (action.reward === 'loot' && action.item) {
      const def = data.ITEM_BY_ID[action.item];
      const icon: PostChoice['icon'] =
        def?.slot === 'weapon'
          ? 'sword'
          : def?.slot === 'armor'
            ? 'shield'
            : def?.effect.healPct
              ? 'heart'
              : /scroll|map/i.test(action.item)
                ? 'scroll'
                : 'star';
      const equipped = target.weapon === action.item || target.armor === action.item;
      return [
        {
          action,
          icon,
          name: t(`item.${action.item}`),
          detail: equipped ? postText('equipped') : t('action.loot'),
          equipped,
          group: 'item',
        },
      ];
    }
    if (action.reward === 'seize')
      return [
        {
          action,
          icon: 'crown',
          name: `${postText('town')} ${action.townId}`,
          detail: t('action.seize'),
          equipped: false,
          group: 'town',
        },
      ];
    return [
      {
        action,
        icon: 'skull',
        name: t(action.alias!),
        detail: postText('prank'),
        equipped: false,
        group: 'prank',
      },
    ];
  });
}
