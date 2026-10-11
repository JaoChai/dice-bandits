import { afterEach, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';

afterEach(() => setLang('th'));

it.each([
  ['en', 'title.hint', 'New here? Dicey teaches you in 4–5 minutes'],
  ['en', 'title.diceyHint', 'Step by step, about 4–5 minutes'],
  ['en', 'practice.invite.title', 'Practice with Dicey ~4–5 min'],
  ['th', 'title.hint', 'ครั้งแรก? ไดซีย์สอนเล่นให้ใน 4–5 นาที'],
  ['th', 'title.diceyHint', 'สอนทีละขั้น ประมาณ 4–5 นาที'],
  ['th', 'practice.invite.title', 'ฝึกเล่นกับไดซีย์ ~4–5 นาที'],
] as const)('advertises the approved tutorial duration in %s %s', (lang, key, copy) => {
  setLang(lang);
  expect(t(key)).toBe(copy);
});
