import { useSyncExternalStore } from 'react';

/** The scheme on screen: Latte is light, every other flavor dark (follows ThemeSync's classes). */
export function useColorScheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribe, () =>
    document.documentElement.classList.contains('latte') ? 'light' : 'dark',
  );
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
