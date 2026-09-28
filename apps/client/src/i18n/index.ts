import en from './en.json';
import th from './th.json';

export type Language = 'th' | 'en';
type Dictionary = Record<string, string>;
type LanguageListener = (language: Language) => void;

const dictionaries: Record<Language, Dictionary> = {
  th: th as Dictionary,
  en: en as Dictionary,
};
const listeners = new Set<LanguageListener>();
const storageKey = 'lang';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'th' || stored === 'en') return stored;
  } catch {
    // Use the browser preference when persistence is unavailable.
  }
  return navigator.language.toLowerCase().startsWith('th') ? 'th' : 'en';
}

let language = initialLanguage();
document.documentElement.lang = language;

export function getLang(): Language {
  return language;
}

export function setLang(next: Language): void {
  language = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    // Keep the selected language in memory even when persistence is unavailable.
  }
  for (const listener of listeners) listener(next);
}

export function onLangChange(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const value = dictionaries[language][key] ?? key;
  return value.replace(/\{([^}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
