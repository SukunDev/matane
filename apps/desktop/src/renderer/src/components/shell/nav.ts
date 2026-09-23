import {
  Bookmark,
  ChartColumn,
  Compass,
  Download,
  Globe,
  History,
  LibraryBig,
  type LucideIcon,
  Puzzle,
  RefreshCw,
  ScanSearch,
} from 'lucide-react';

export interface NavLeaf {
  to:
    | '/library'
    | '/updates'
    | '/history'
    | '/browse/sources'
    | '/browse/extensions'
    | '/browse/global-search'
    | '/downloads'
    | '/bookmarks'
    | '/statistics';
  labelKey:
    | 'library'
    | 'updates'
    | 'history'
    | 'sources'
    | 'extensions'
    | 'globalSearch'
    | 'downloads'
    | 'bookmarks'
    | 'statistics';
  icon: LucideIcon;
}

export interface NavGroup {
  labelKey: 'browse';
  icon: LucideIcon;
  children: NavLeaf[];
}

/** Sidebar order from docs/ui/screens/01-library.png. */
export const NAV_ITEMS: (NavLeaf | NavGroup)[] = [
  { to: '/library', labelKey: 'library', icon: LibraryBig },
  { to: '/updates', labelKey: 'updates', icon: RefreshCw },
  { to: '/history', labelKey: 'history', icon: History },
  {
    labelKey: 'browse',
    icon: Compass,
    children: [
      { to: '/browse/sources', labelKey: 'sources', icon: Globe },
      { to: '/browse/extensions', labelKey: 'extensions', icon: Puzzle },
      { to: '/browse/global-search', labelKey: 'globalSearch', icon: ScanSearch },
    ],
  },
  { to: '/downloads', labelKey: 'downloads', icon: Download },
  { to: '/bookmarks', labelKey: 'bookmarks', icon: Bookmark },
  { to: '/statistics', labelKey: 'statistics', icon: ChartColumn },
];
