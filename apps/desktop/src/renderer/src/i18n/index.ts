import { LANGUAGES, type Language } from '@manga-reader/shared/theme';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import id from './locales/id.json';

export const resources = { en: { translation: en }, id: { translation: id } } as const;

/** `null` means "follow the OS"; unknown OS languages fall back to English. */
export function resolveLanguage(preferred: Language | null, osLocale: string): Language {
  if (preferred) return preferred;
  const base = osLocale.toLowerCase().split(/[-_]/)[0];
  return (LANGUAGES as readonly string[]).includes(base ?? '') ? (base as Language) : 'en';
}

export async function initI18n(language: Language): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
