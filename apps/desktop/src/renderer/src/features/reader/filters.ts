import type { ReaderFilters, ReaderSettings } from '@manga-reader/shared';
import type { CSSProperties } from 'react';

/** The CSS filter for the pages, or "none" when nothing is changed. */
export function cssFilter(filters: ReaderFilters): string {
  const parts: string[] = [];
  if (filters.brightness !== 100) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.grayscale) parts.push('grayscale(1)');
  if (filters.invert) parts.push('invert(1)');
  if (filters.warm > 0) parts.push(`sepia(${filters.warm}%)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

const BACKGROUNDS: Record<Exclude<ReaderSettings['background'], 'custom'>, string> = {
  black: '#000000',
  gray: '#2b2b30',
  white: '#ffffff',
};

/** The reader's background colour and the filter its pages get (`.reader-pages [data-page]`). */
export function readerStyle(reader: ReaderSettings): CSSProperties {
  return {
    backgroundColor: reader.background === 'custom' ? reader.backgroundColor : BACKGROUNDS[reader.background],
    ['--reader-filter' as string]: cssFilter(reader.filters),
  };
}
