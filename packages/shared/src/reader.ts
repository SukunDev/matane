// Reader option lists, zod-free so the renderer can import them without the schemas.
export const READER_MODES = ['auto', 'single', 'double', 'webtoon', 'vertical'] as const;
export const READER_DIRECTIONS = ['auto', 'ltr', 'rtl'] as const;
export const READER_FITS = ['width', 'height', 'screen', 'original'] as const;
export const TAP_ZONES = ['l', 'kindle', 'edges', 'lr', 'off'] as const;
export const READER_BACKGROUNDS = ['black', 'gray', 'white', 'custom'] as const;
/** Modes a manga type can default to ("auto" resolves to one of these). */
export const RESOLVED_MODES = ['single', 'double', 'webtoon', 'vertical'] as const;
/** Manga types with their own reader defaults; "other" is a manga without a known type. */
export const READER_TYPES = ['manga', 'manhwa', 'manhua', 'comic', 'other'] as const;

/** Pages taller than this are cut into segments in webtoon and vertical modes (docs/BRAINSTORM.md §6.1). */
export const SPLIT_ABOVE_PX = 5000;
/** Target height of one segment. */
export const SEGMENT_HEIGHT_PX = 4000;

/**
 * Heights of the segments a page of this size is shown as: one segment (the page) unless it is
 * taller than `SPLIT_ABOVE_PX`, then equal parts of at most `SEGMENT_HEIGHT_PX` (the last one takes
 * the remainder). Main cuts and the renderer lays out with the same plan.
 */
export function pageSegments(width: number, height: number): number[] {
  if (height <= SPLIT_ABOVE_PX || width <= 0) return [height];
  const count = Math.ceil(height / SEGMENT_HEIGHT_PX);
  const base = Math.floor(height / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? height - base * (count - 1) : base));
}

/**
 * Reader keyboard actions (docs/BRAINSTORM.md §6.1). "Page left/right" follow the screen: in a
 * right-to-left manga left turns forward; in a strip they scroll a screen up/down.
 */
export const READER_ACTIONS = [
  'nextPage',
  'prevPage',
  'pageRight',
  'pageLeft',
  'scrollDown',
  'scrollUp',
  'firstPage',
  'lastPage',
  'nextChapter',
  'prevChapter',
  'fullscreen',
  'menu',
  'exit',
  'autoScroll',
  'zoomIn',
  'zoomOut',
  'zoomReset',
] as const;
export type ReaderAction = (typeof READER_ACTIONS)[number];

/** Keys as `keyId` names them: modifiers first ("Ctrl+=", "Shift+Space"), letters upper case. */
export const DEFAULT_KEYMAP: Record<ReaderAction, readonly string[]> = {
  nextPage: ['PageDown', 'Space'],
  prevPage: ['PageUp', 'Shift+Space'],
  pageRight: ['ArrowRight', 'D'],
  pageLeft: ['ArrowLeft', 'A'],
  scrollDown: ['ArrowDown'],
  scrollUp: ['ArrowUp'],
  firstPage: ['Home'],
  lastPage: ['End'],
  nextChapter: [']'],
  prevChapter: ['['],
  fullscreen: ['F'],
  menu: ['M'],
  exit: ['Escape'],
  autoScroll: ['S'],
  zoomIn: ['Ctrl+=', 'Ctrl++'],
  zoomOut: ['Ctrl+-'],
  zoomReset: ['Ctrl+0'],
};

/** At most this many keys per action. */
export const MAX_KEYS_PER_ACTION = 4;

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified']);

/**
 * The name of a key press, or null for a lone modifier. Shift is part of the name only for named
 * keys ("Shift+Space"); for characters the key itself already says it ("+" vs "=").
 */
export function keyId(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  let base = event.key === ' ' ? 'Space' : event.key;
  if (base.length === 1) base = base.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && base.length > 1) parts.push('Shift');
  return [...parts, base].join('+');
}

/** Defaults with the user's changes on top (an action given no keys is turned off). */
export function effectiveKeymap(
  override: Partial<Record<ReaderAction, readonly string[]>>,
): Record<ReaderAction, readonly string[]> {
  return { ...DEFAULT_KEYMAP, ...override };
}

/** The action bound to a key. */
export function actionForKey(keymap: Record<ReaderAction, readonly string[]>, key: string): ReaderAction | null {
  return READER_ACTIONS.find((action) => keymap[action].includes(key)) ?? null;
}
