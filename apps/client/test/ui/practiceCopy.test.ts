import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';

afterEach(() => setLang('th'));

describe('practice coach copy', () => {
  it('points the fork lesson at the blue-framed button, not a board space', () => {
    setLang('th');
    expect(t('practice.guide.action.chooseBranch.body')).toBe(
      'เลือกทางไปหีบ\nแตะปุ่มที่มีกรอบน้ำเงิน',
    );
    setLang('en');
    expect(t('practice.guide.action.chooseBranch.body')).toBe(
      'Take the path to the chest.\nTap the blue-framed button.',
    );
  });

  it('has the wrong-tap nudge in both languages', () => {
    setLang('th');
    expect(t('practice.nudge')).toBe('ยังไม่ใช่ปุ่มนี้ ลองปุ่มกรอบน้ำเงินนะ');
    setLang('en');
    expect(t('practice.nudge')).toBe('Not that one yet. Try the blue-framed button.');
  });

  it('spells the mascot ไดซี่ in every Thai string', () => {
    setLang('th');
    for (const key of ['title.hint', 'title.dicey', 'practice.invite.title'])
      expect(t(key), key).not.toContain('ไดซีย์');
    expect(t('title.hint')).toBe('ครั้งแรก? ไดซี่สอนเล่นให้ใน 4–5 นาที');
    expect(t('title.dicey')).toBe('ฝึกกับไดซี่');
    expect(t('practice.invite.title')).toBe('ฝึกเล่นกับไดซี่ ~4–5 นาที');
  });
});
