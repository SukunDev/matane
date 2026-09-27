import { LIBRARY_DISPLAYS, LIBRARY_SORTS, type LibrarySettings, MANGA_STATUSES } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  Grid2x2,
  Grid3x3,
  Image,
  ListFilter,
  List,
  type LucideIcon,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchField } from '../../components/SearchField';
import { Button } from '../../components/ui/button';
import { sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { filterCount } from './settings';

const DISPLAY_ICONS: Record<LibrarySettings['display'], LucideIcon> = {
  comfortable: Grid2x2,
  compact: Grid3x3,
  cover: Image,
  list: List,
};
const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent';
const popoverClass = 'z-50 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl';

export function LibraryToolbar({
  settings,
  onChange,
  query,
  onQuery,
}: {
  settings: LibrarySettings;
  onChange: (patch: Partial<LibrarySettings>) => void;
  query: string;
  onQuery: (query: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SearchField value={query} onChange={onQuery} placeholder={t('library.filterPlaceholder')} className="w-56" />
      <FilterPopover settings={settings} onChange={onChange} />
      <SortMenu settings={settings} onChange={onChange} />
      <div role="radiogroup" aria-label={t('library.display.label')} className="flex rounded-lg border p-0.5">
        {LIBRARY_DISPLAYS.map((display) => {
          const Icon = DISPLAY_ICONS[display];
          return (
            <button
              key={display}
              type="button"
              role="radio"
              aria-checked={settings.display === display}
              title={t(`library.display.${display}`)}
              onClick={() => onChange({ display })}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
                settings.display === display && 'bg-primary/15 text-primary hover:text-primary',
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      {settings.display !== 'list' && <CoverSizeSlider value={settings.coverSize} onChange={onChange} />}
    </div>
  );
}

/** Local while dragging; saved once the pointer or key is released. */
function CoverSizeSlider({ value, onChange }: { value: number; onChange: (patch: Partial<LibrarySettings>) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => {
    if (draft !== null) onChange({ coverSize: draft });
    setDraft(null);
  };
  return (
    <label className="flex h-8 items-center gap-2 rounded-lg border px-2 text-muted-foreground">
      <ZoomOut className="size-3.5" />
      <input
        type="range"
        min={100}
        max={280}
        step={10}
        value={draft ?? value}
        aria-label={t('library.coverSize')}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-24 accent-primary"
      />
      <ZoomIn className="size-3.5" />
    </label>
  );
}

function FilterPopover({
  settings,
  onChange,
}: {
  settings: LibrarySettings;
  onChange: (patch: Partial<LibrarySettings>) => void;
}) {
  const { t } = useTranslation();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const active = filterCount(settings);
  const toggleIn = <T,>(list: readonly T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" className={cn(active > 0 && 'border-primary text-primary')}>
          <SlidersHorizontal />
          {t('library.filter.label')}
          {active > 0 && <span className="size-1.5 rounded-full bg-primary" aria-label={String(active)} />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={cn(popoverClass, 'flex w-64 flex-col gap-1 p-2')}>
          <FilterToggle on={settings.unreadOnly} onClick={() => onChange({ unreadOnly: !settings.unreadOnly })}>
            {t('library.filter.unread')}
          </FilterToggle>
          <FilterToggle on={settings.readingOnly} onClick={() => onChange({ readingOnly: !settings.readingOnly })}>
            {t('library.filter.reading')}
          </FilterToggle>
          <FilterToggle
            on={settings.bookmarkedOnly}
            onClick={() => onChange({ bookmarkedOnly: !settings.bookmarkedOnly })}
          >
            {t('library.filter.bookmarked')}
          </FilterToggle>
          <FilterToggle
            on={settings.downloadedOnly}
            onClick={() => onChange({ downloadedOnly: !settings.downloadedOnly })}
          >
            {t('library.filter.downloaded')}
          </FilterToggle>
          <p className="mt-2 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t('library.filter.status')}
          </p>
          {MANGA_STATUSES.map((status) => (
            <FilterToggle
              key={status}
              on={settings.status.includes(status)}
              onClick={() => onChange({ status: toggleIn(settings.status, status) })}
            >
              {t(`manga.status.${status}`)}
            </FilterToggle>
          ))}
          {sources.length > 1 && (
            <>
              <p className="mt-2 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t('library.filter.source')}
              </p>
              {sources.map((source) => (
                <FilterToggle
                  key={source.id}
                  on={settings.sourceIds.includes(source.id)}
                  onClick={() => onChange({ sourceIds: toggleIn(settings.sourceIds, source.id) })}
                >
                  {source.name}
                  <span className="text-xs text-muted-foreground">{source.lang.toUpperCase()}</span>
                </FilterToggle>
              ))}
            </>
          )}
          {active > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() =>
                onChange({
                  unreadOnly: false,
                  readingOnly: false,
                  bookmarkedOnly: false,
                  downloadedOnly: false,
                  status: [],
                  sourceIds: [],
                })
              }
            >
              <ListFilter />
              {t('library.filter.clear')}
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterToggle({
  on,
  onClick,
  disabled,
  title,
  children,
}: {
  on: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border border-input',
          on && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {on && <Check className="size-3" />}
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2 truncate">{children}</span>
    </button>
  );
}

function SortMenu({
  settings,
  onChange,
}: {
  settings: LibrarySettings;
  onChange: (patch: Partial<LibrarySettings>) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm">
          {settings.ascending ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
          {t('library.sort.label', { sort: t(`library.sort.${settings.sort}`) })}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={cn(popoverClass, 'min-w-52')}>
          <DropdownMenu.RadioGroup
            value={settings.sort}
            onValueChange={(value) => {
              const sort = LIBRARY_SORTS.find((s) => s === value);
              if (sort) onChange({ sort });
            }}
          >
            {LIBRARY_SORTS.map((sort) => (
              <DropdownMenu.RadioItem key={sort} value={sort} className={menuItem}>
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4 text-primary" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {t(`library.sort.${sort}`)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={menuItem}
            onSelect={(event) => {
              event.preventDefault();
              onChange({ ascending: !settings.ascending });
            }}
          >
            {settings.ascending ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
            {settings.ascending ? t('library.sort.ascending') : t('library.sort.descending')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
