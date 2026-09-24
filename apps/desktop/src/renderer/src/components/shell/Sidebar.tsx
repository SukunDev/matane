import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { libraryCountsQuery } from '../../lib/library';
import { cn } from '../../lib/utils';
import { NAV_ITEMS, type NavLeaf } from './nav';

const itemClass =
  'flex h-9 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
const activeClass = 'border-primary bg-primary/15 font-semibold text-primary hover:bg-primary/15 hover:text-primary';

function SidebarLink({
  item,
  collapsed,
  nested,
  badge,
}: {
  item: NavLeaf;
  collapsed: boolean;
  nested?: boolean;
  badge?: number;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={collapsed ? t(`nav.${item.labelKey}`) : undefined}
      className={cn(itemClass, nested && !collapsed && 'h-8 pl-4 text-[13px]', collapsed && 'justify-center px-0')}
      activeProps={{ className: activeClass }}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{t(`nav.${item.labelKey}`)}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="rounded-md bg-primary/20 px-1.5 text-[11px] font-semibold text-primary">{badge}</span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const updateSettings = useUpdateSettings();
  const collapsed = settings?.sidebarCollapsed ?? false;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [browseOpen, setBrowseOpen] = useState(true);
  const { data: counts } = useQuery(libraryCountsQuery);
  const badges: Partial<Record<NavLeaf['to'], number>> = { '/library': counts?.all };

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-sidebar px-3 py-3 transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className={cn('mb-3 flex items-center gap-2.5 border-b pb-3', collapsed ? 'justify-center' : 'px-1')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpen className="size-4.5" />
        </div>
        {!collapsed && <span className="text-base font-semibold tracking-tight">{t('app.name')}</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          if ('to' in item)
            return <SidebarLink key={item.to} item={item} collapsed={collapsed} badge={badges[item.to]} />;
          const Icon = item.icon;
          const groupActive = item.children.some((child) => pathname.startsWith(child.to));
          if (collapsed) {
            return item.children.map((child) => <SidebarLink key={child.to} item={child} collapsed />);
          }
          return (
            <div key={item.labelKey} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setBrowseOpen((open) => !open)}
                aria-expanded={browseOpen}
                className={cn(itemClass, groupActive && 'text-foreground')}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 text-left">{t(`nav.${item.labelKey}`)}</span>
                <ChevronDown className={cn('size-4 transition-transform', !browseOpen && '-rotate-90')} />
              </button>
              {browseOpen && (
                <div className="ml-5 flex flex-col gap-0.5 border-l pl-2">
                  {item.children.map((child) => (
                    <SidebarLink key={child.to} item={child} collapsed={false} nested />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mt-2 flex flex-col gap-0.5 border-t pt-2">
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          title={collapsed ? t('nav.settings') : undefined}
          // Highlight for every settings section, not just the linked one.
          className={cn(itemClass, collapsed && 'justify-center px-0', pathname.startsWith('/settings') && activeClass)}
        >
          <Settings className="size-4 shrink-0" />
          {!collapsed && <span>{t('nav.settings')}</span>}
        </Link>
        <button
          type="button"
          onClick={() => updateSettings.mutate({ sidebarCollapsed: !collapsed })}
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          className={cn(itemClass, collapsed && 'justify-center px-0')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>{t('nav.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}
