import type { AppSettings } from '@manga-reader/shared';

const FLAVOR_CLASSES = ['latte', 'frappe', 'macchiato', 'mocha', 'amoled'] as const;

/** Resolves the `theme` setting to the classes placed on <html>. */
export function themeClasses(theme: AppSettings['theme'], prefersDark: boolean): string[] {
  switch (theme) {
    case 'system':
      return [prefersDark ? 'mocha' : 'latte'];
    case 'amoled':
      return ['mocha', 'amoled'];
    default:
      return [theme];
  }
}

export function applyTheme(
  settings: Pick<AppSettings, 'theme' | 'accent'>,
  root: HTMLElement,
  prefersDark: boolean,
): void {
  root.classList.remove(...FLAVOR_CLASSES);
  root.classList.add(...themeClasses(settings.theme, prefersDark));
  root.dataset['accent'] = settings.accent;
  root.style.colorScheme = root.classList.contains('latte') ? 'light' : 'dark';
}
