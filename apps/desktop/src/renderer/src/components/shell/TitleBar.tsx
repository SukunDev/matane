import { useCanGoBack, useMatches, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, WifiOff } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { appInfoQuery } from '../../lib/ipc';
import { useCrumbStore } from '../../stores/crumbs';
import { useUiStore } from '../../stores/ui';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { WindowControls } from './WindowControls';

export function TitleBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const staticCrumbs = useMatches({
    select: (matches) => matches.flatMap((match) => match.staticData.crumbs ?? []),
  });
  const dynamicCrumbs = useCrumbStore((state) => state.labels);
  const crumbs = [...staticCrumbs.map((key) => t(`nav.${key}`)), ...dynamicCrumbs];
  const { data: info } = useQuery(appInfoQuery);
  const online = useUiStore((state) => state.online);
  const isMac = info?.platform === 'darwin';
  const paletteShortcut = isMac ? '⌘K' : 'Ctrl K';

  return (
    <header className="drag-region relative flex h-10 shrink-0 items-center border-b bg-sidebar">
      {/* Leave room for the native traffic lights on macOS. */}
      <div className={isMac ? 'w-20' : 'w-2'} />
      <div className="no-drag flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('titlebar.back')}
          disabled={!canGoBack}
          onClick={() => router.history.back()}
        >
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" title={t('titlebar.forward')} onClick={() => router.history.forward()}>
          <ChevronRight />
        </Button>
      </div>

      {/* Stops before the centered search box (w-80), whatever the window width. */}
      <nav
        aria-label="Breadcrumb"
        className="ml-2 flex max-w-[calc(50%-14rem)] min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"
      >
        <span className="shrink-0 font-semibold text-foreground">{t('app.name')}</span>
        {crumbs.map((label, index) => (
          <Fragment key={`${index}-${label}`}>
            <span>/</span>
            <span className={cn('truncate', index === crumbs.length - 1 && 'text-foreground')}>{label}</span>
          </Fragment>
        ))}
      </nav>

      {/* The command palette itself ships in a later phase (BRAINSTORM.md §6.6). */}
      <button
        type="button"
        title={t('titlebar.searchSoon')}
        className="no-drag absolute left-1/2 flex h-7 w-80 -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-2.5 text-[13px] text-muted-foreground hover:border-input"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">{t('titlebar.search')}</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] whitespace-nowrap">{paletteShortcut}</kbd>
      </button>

      <div className="ml-auto flex h-full items-center gap-1">
        {!online && (
          <span className="no-drag flex items-center gap-1.5 px-2 text-xs text-ctp-peach" title={t('titlebar.offline')}>
            <WifiOff className="size-3.5" />
            {t('titlebar.offline')}
          </span>
        )}
        {!isMac && <WindowControls />}
      </div>
    </header>
  );
}
