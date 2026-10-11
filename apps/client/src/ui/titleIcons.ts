// Decorative SVGs from the owner-approved title mock.
export const titleIcons = {
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  solo: '<svg viewBox="0 0 32 32" width="34" height="34"><rect x="5" y="5" width="22" height="22" rx="6" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><circle cx="11" cy="11" r="2.4" fill="#5c3317"/><circle cx="16" cy="16" r="2.4" fill="#5c3317"/><circle cx="21" cy="21" r="2.4" fill="#5c3317"/></svg>',
  friends:
    '<svg viewBox="0 0 32 32" width="34" height="34"><circle cx="11" cy="11" r="5" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><circle cx="22" cy="13" r="4.2" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><path d="M3 27c1-5 4.5-8 8-8s7 3 8 8z" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><path d="M17 27c.7-4 3-6.4 5.4-6.4S28 23 29 27z" fill="#fff" stroke="#5c3317" stroke-width="2.5"/></svg>',
  dicey:
    '<svg viewBox="0 0 32 32" width="34" height="34"><path d="M3 12c3-4 5-4 6-1M29 12c-3-4-5-4-6-1" stroke="#5c3317" stroke-width="2.2" fill="#fff"/><rect x="8" y="7" width="16" height="16" rx="5" fill="#fff" stroke="#5c3317" stroke-width="2.5"/><circle cx="13" cy="14" r="1.8" fill="#5c3317"/><circle cx="19" cy="14" r="1.8" fill="#5c3317"/><path d="M13 18.5q3 2.5 6 0" stroke="#5c3317" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 26h8" stroke="#5c3317" stroke-width="2.5" stroke-linecap="round"/></svg>',
  book: '<svg viewBox="0 0 32 32" width="34" height="34"><path d="M5 7c4-1.5 7.5-1 11 1.5V27c-3.5-2.5-7-3-11-1.5z M27 7c-4-1.5-7.5-1-11 1.5V27c3.5-2.5 7-3 11-1.5z" fill="#fff" stroke="#5c3317" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>',
};
export function titleIcon(name: keyof typeof titleIcons): string {
  return titleIcons[name].replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}
