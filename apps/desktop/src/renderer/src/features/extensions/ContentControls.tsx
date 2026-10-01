import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Languages, RotateCcw } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { useContentFilter } from '../../lib/content';
import { availableExtensionsQuery } from '../../lib/extensions';
import { languageName } from '../../lib/format';
import { useUpdateSettings } from '../../lib/ipc';
import { sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { Toggle } from '../settings/controls';

const menuItem =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4';

/** Offered even before any extension uses them. */
export const COMMON_LANGUAGES = [
  'en',
  'id',
  'ja',
  'ko',
  'zh',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'ru',
  'vi',
  'th',
  'tr',
  'ar',
  'pl',
];

/** Content languages (a setting): extensions and sources in other languages are hidden. */
export function ContentLanguagePicker({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { browse, languages } = useContentFilter();
  const updateSettings = useUpdateSettings();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const { data: available = [] } = useQuery(availableExtensionsQuery);
  const known = new Set([
    ...languages,
    ...COMMON_LANGUAGES,
    ...sources.map((s) => s.lang),
    ...available.flatMap((a) => a.langs),
  ]);
  known.delete('all');
  known.delete('multi');
  const options = [...known].sort((a, b) =>
    languageName(a, i18n.language).localeCompare(languageName(b, i18n.language)),
  );
  const save = (next: string[] | null) => updateSettings.mutate({ browse: { ...browse, languages: next } });
  const label = languages.map((l) => l.toUpperCase()).join(', ');

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm" className={className} aria-label={t('settings.browse.languages.label')}>
          <Languages />
          <span className="max-w-48 truncate">{t('extensions.languages.label', { langs: label })}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {options.map((lang) => {
            const checked = languages.includes(lang);
            return (
              <DropdownMenu.CheckboxItem
                key={lang}
                className={cn(menuItem, 'relative pl-8')}
                checked={checked}
                // At least one language stays on.
                disabled={checked && languages.length === 1}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(on) => save(on ? [...languages, lang] : languages.filter((l) => l !== lang))}
              >
                <DropdownMenu.ItemIndicator className="absolute left-2">
                  <Check />
                </DropdownMenu.ItemIndicator>
                {languageName(lang, i18n.language)}
                <span className="ml-auto text-xs text-muted-foreground">{lang.toUpperCase()}</span>
              </DropdownMenu.CheckboxItem>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={menuItem} disabled={browse.languages === null} onSelect={() => save(null)}>
            <RotateCcw />
            {t('settings.browse.languages.reset')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Show adult (NSFW) extensions and sources; turning it on asks first. */
export function NsfwToggle({ id }: { id?: string }) {
  const { t } = useTranslation();
  const { browse } = useContentFilter();
  const updateSettings = useUpdateSettings();
  const [asking, setAsking] = useState(false);
  const save = (showNsfw: boolean) => updateSettings.mutate({ browse: { ...browse, showNsfw } });
  return (
    <>
      <Toggle
        id={id}
        label={t('settings.browse.nsfw.label')}
        checked={browse.showNsfw}
        onChange={(on) => (on ? setAsking(true) : save(false))}
      />
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('settings.browse.nsfw.confirmTitle')}
        description={t('settings.browse.nsfw.confirmDescription')}
        confirmLabel={t('settings.browse.nsfw.confirm')}
        destructive={false}
        onConfirm={() => save(true)}
      />
    </>
  );
}
