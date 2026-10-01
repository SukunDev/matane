import type { ReaderAction } from '@manga-reader/shared/reader';
import { type RefObject, createContext, useContext, useEffect } from 'react';

export {
  DEFAULT_KEYMAP,
  READER_ACTIONS,
  type ReaderAction,
  actionForKey,
  effectiveKeymap,
  keyId,
} from '@manga-reader/shared/reader';

export type ReaderHandlers = Partial<Record<ReaderAction, () => void>>;

/**
 * The reader has one key listener (ReaderPage); the view on screen lends it the handlers for page
 * actions (turning, scrolling, zoom) through this ref.
 */
export const ReaderKeysContext = createContext<RefObject<ReaderHandlers> | null>(null);

/** Registers the view's handlers while it is mounted. Pass a memoized object. */
export function useReaderKeys(handlers: ReaderHandlers): void {
  const ref = useContext(ReaderKeysContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = handlers;
    return () => {
      if (ref.current === handlers) ref.current = {};
    };
  }, [ref, handlers]);
}

const SYMBOLS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
};

/** "Ctrl+=" → ["Ctrl", "="], "Ctrl++" → ["Ctrl", "+"], "ArrowLeft" → ["←"]: the chips of a key. */
export function keyParts(key: string): string[] {
  const parts = key.endsWith('++') ? [...key.slice(0, -2).split('+').filter(Boolean), '+'] : key.split('+');
  return parts.map((part) => SYMBOLS[part] ?? part);
}

export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}
