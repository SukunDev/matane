import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { osLocaleQuery, settingsQuery } from '../lib/ipc';
import i18n, { resolveLanguage } from './index';

export function LanguageSync(): null {
  const { data: settings } = useQuery(settingsQuery);
  const { data: osLocale } = useQuery(osLocaleQuery);

  useEffect(() => {
    if (!settings || !osLocale) return;
    const language = resolveLanguage(settings.language, osLocale);
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [settings, osLocale]);

  return null;
}
