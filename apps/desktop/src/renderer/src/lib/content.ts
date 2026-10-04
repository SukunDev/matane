import { DEFAULT_SETTINGS, contentLanguages, isContentVisible } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { settingsQuery } from './ipc';

/**
 * Content settings in effect (docs/BRAINSTORM.md §6.6): which languages are shown and whether adult
 * extensions and sources are. `visible` filters anything with languages and an NSFW flag.
 */
export function useContentFilter() {
  const { i18n } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const browse = settings?.browse ?? DEFAULT_SETTINGS.browse;
  return {
    browse,
    languages: contentLanguages(browse, i18n.language),
    visible: (item: { langs: readonly string[]; nsfw: boolean }) => isContentVisible(item, browse, i18n.language),
  };
}
