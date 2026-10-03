import { LIBRARY_DISPLAYS, type LibrarySettings } from '@manga-reader/shared';
import { Grid2x2, Grid3x3, Image, List, type LucideIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

type Display = LibrarySettings['display'];

const DISPLAY_ICONS: Record<Display, LucideIcon> = {
  comfortable: Grid2x2,
  compact: Grid3x3,
  cover: Image,
  list: List,
};

/** Display mode toggle and cover size slider, shared by the library and the browse lists. */
export function CoverViewControls({
  display,
  coverSize,
  onChange,
}: {
  display: Display;
  coverSize: number;
  onChange: (patch: { display?: Display; coverSize?: number }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div role="radiogroup" aria-label={t('library.display.label')} className="flex rounded-lg border p-0.5">
        {LIBRARY_DISPLAYS.map((mode) => {
          const Icon = DISPLAY_ICONS[mode];
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={display === mode}
              title={t(`library.display.${mode}`)}
              onClick={() => onChange({ display: mode })}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
                display === mode && 'bg-primary/15 text-primary hover:text-primary',
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      {display !== 'list' && <CoverSizeSlider value={coverSize} onChange={(next) => onChange({ coverSize: next })} />}
    </>
  );
}

/** Idle time after the last key step before the size is saved (a held key steps every ~30 ms). */
const SAVE_DELAY_MS = 200;

/**
 * Follows the pointer or keys locally and saves once they settle: on release for a drag, after a
 * short pause for keys. Steps build on the local value, not on whatever the last save has reached.
 */
function CoverSizeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragging = useRef(false);
  const save = useRef(onChange);
  useEffect(() => {
    save.current = onChange;
  });

  // The saved value follows in unless the user is still moving the slider.
  useEffect(() => {
    if (pending.current === null) setLocal(value);
  }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    dragging.current = false;
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== value) save.current(next);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (next: number) => {
    setLocal(next);
    pending.current = next;
    clearTimeout(timer.current);
    if (!dragging.current) timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  return (
    <label className="flex h-8 items-center gap-2 rounded-lg border px-2 text-muted-foreground">
      <ZoomOut className="size-3.5" />
      <input
        type="range"
        min={100}
        max={280}
        step={10}
        value={local}
        aria-label={t('library.coverSize')}
        onChange={(event) => step(Number(event.target.value))}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={flush}
        onBlur={flush}
        className="w-24 accent-primary"
      />
      <ZoomIn className="size-3.5" />
    </label>
  );
}
