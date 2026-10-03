import type { MangaInfo } from '@manga-reader/shared';
import { Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type MouseEvent, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coverSrc } from '../../components/CoverImage';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const BUTTON_STEP = 1.5;
const DOUBLE_CLICK_SCALE = 2.5;

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: MIN_SCALE, x: 0, y: 0 };

/**
 * Full-size cover viewer: wheel / buttons / `+` `-` `0` to zoom, drag to pan when zoomed in,
 * double-click to toggle zoom. Clicking outside the image (or Esc) closes it.
 */
export function CoverPreview({
  manga,
  open,
  onOpenChange,
}: {
  manga: MangaInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/85 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">{manga.title || t('manga.cover.preview')}</Dialog.Title>
          {/* Mounted only while open, so every opening starts fitted to the window. */}
          {manga.coverKey && (
            <Viewer src={coverSrc(manga.id, manga.coverKey)} alt={manga.title} onClose={() => onOpenChange(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; moved: boolean } | null>(null);

  /** Keeps the picture from being dragged out of reach: its centre may reach the stage's edge, no further. */
  const clamp = (next: View): View => {
    if (next.scale <= MIN_SCALE || !image.current) return FIT;
    const limitX = (image.current.offsetWidth * next.scale) / 2;
    const limitY = (image.current.offsetHeight * next.scale) / 2;
    return {
      scale: next.scale,
      x: Math.min(limitX, Math.max(-limitX, next.x)),
      y: Math.min(limitY, Math.max(-limitY, next.y)),
    };
  };

  /** Zooms to `scale`, keeping the point under (`originX`, `originY`) — relative to the stage's centre — fixed. */
  const zoomTo = (scale: number | ((current: number) => number), originX = 0, originY = 0) =>
    setView((current) => {
      const wanted = typeof scale === 'function' ? scale(current.scale) : scale;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, wanted));
      const ratio = next / current.scale;
      return clamp({
        scale: next,
        x: originX - (originX - current.x) * ratio,
        y: originY - (originY - current.y) * ratio,
      });
    });

  const fromCentre = (clientX: number, clientY: number) => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const onWheel = (event: WheelEvent) => {
    const origin = fromCentre(event.clientX, event.clientY);
    zoomTo((current) => current * Math.exp(-event.deltaY * 0.002), origin.x, origin.y);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    // Capture only once it is a drag, so a plain click keeps its real target.
    if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId);
    start.moved = true;
    start.x = event.clientX;
    start.y = event.clientY;
    setDragging(true);
    setView((current) => clamp({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const onPointerUp = (event: PointerEvent) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    // A plain click on the empty backdrop closes the preview; a click on the picture does not.
    if (!start.moved && event.target === event.currentTarget) onClose();
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (event.target !== image.current) return;
    const origin = fromCentre(event.clientX, event.clientY);
    if (view.scale > MIN_SCALE) setView(FIT);
    else zoomTo(DOUBLE_CLICK_SCALE, origin.x, origin.y);
  };

  // Window-level so the shortcuts work wherever focus sits inside the dialog.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') zoomTo((current) => current * BUTTON_STEP);
      else if (event.key === '-' || event.key === '_') zoomTo((current) => current / BUTTON_STEP);
      else if (event.key === '0') setView(FIT);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomTo only touches state and refs
  }, []);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-1 p-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/90 p-1 shadow-xl backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('manga.cover.zoomOut')}
            title={t('manga.cover.zoomOut')}
            disabled={view.scale <= MIN_SCALE}
            onClick={() => zoomTo((current) => current / BUTTON_STEP)}
          >
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {Math.round(view.scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('manga.cover.zoomIn')}
            title={t('manga.cover.zoomIn')}
            disabled={view.scale >= MAX_SCALE}
            onClick={() => zoomTo((current) => current * BUTTON_STEP)}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('manga.cover.zoomReset')}
            title={t('manga.cover.zoomReset')}
            disabled={view.scale === MIN_SCALE}
            onClick={() => setView(FIT)}
          >
            <Maximize />
          </Button>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" aria-label={t('common.close')} title={t('common.close')}>
              <X />
            </Button>
          </Dialog.Close>
        </div>
      </div>

      <div
        ref={stage}
        className={cn(
          'flex flex-1 touch-none items-center justify-center overflow-hidden p-8 select-none',
          view.scale > MIN_SCALE ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={image}
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          className={cn(
            'max-h-full max-w-full rounded-lg object-contain shadow-2xl shadow-black/50',
            !dragging && 'transition-transform duration-100',
          )}
        />
      </div>
    </>
  );
}
