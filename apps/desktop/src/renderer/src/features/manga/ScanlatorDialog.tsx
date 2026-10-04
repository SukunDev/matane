import type { ChapterInfo, MangaInfo, ScanlatorPrefs } from '@manga-reader/shared';
import { scanlatorKey } from '@manga-reader/shared/chapters';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';

/**
 * Per-manga scanlators (docs/BRAINSTORM.md §6.2): hide groups, and order them by priority, which picks
 * the version when several groups released the same chapter.
 */
export function ScanlatorDialog({
  manga,
  chapters,
  open,
  onOpenChange,
}: {
  manga: MangaInfo;
  chapters: ChapterInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t('manga.scanlators.title')}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted-foreground">
            {t('manga.scanlators.description')}
          </Dialog.Description>
          {/* Mounted only while open, so every opening starts from the saved prefs. */}
          <ScanlatorEditor manga={manga} chapters={chapters} onDone={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Saved priority first (groups that still exist), then the rest by chapter count. */
function initialOrder(prefs: ScanlatorPrefs, counts: Map<string, number>): string[] {
  const ranked = prefs.priority.filter((name) => counts.has(name));
  const rest = [...counts.keys()]
    .filter((name) => !ranked.includes(name))
    .sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  return [...ranked, ...rest];
}

function ScanlatorEditor({
  manga,
  chapters,
  onDone,
}: {
  manga: MangaInfo;
  chapters: ChapterInfo[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [counts] = useState(() => {
    const map = new Map<string, number>();
    for (const chapter of chapters) map.set(scanlatorKey(chapter), (map.get(scanlatorKey(chapter)) ?? 0) + 1);
    return map;
  });
  const [order, setOrder] = useState(() => initialOrder(manga.scanlatorPrefs, counts));
  // Without an explicit order, the version rule is "same group as before, else newest".
  const [ranked, setRanked] = useState(manga.scanlatorPrefs.priority.length > 0);
  const [hidden, setHidden] = useState(() => new Set(manga.scanlatorPrefs.hidden));
  const [dragging, setDragging] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (prefs: ScanlatorPrefs) => ipc.invoke('manga.setScanlatorPrefs', { mangaId: manga.id, prefs }),
    onSuccess: onDone,
  });

  const move = (name: string, to: number) => {
    const next = order.filter((n) => n !== name);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, name);
    setOrder(next);
    setRanked(true);
  };
  const toggleHidden = (name: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <>
      <ol className="flex min-h-0 flex-col gap-1 overflow-y-auto" aria-label={t('manga.scanlators.title')}>
        {order.map((name, index) => {
          const isHidden = hidden.has(name);
          return (
            <li
              key={name}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                setDragging(name);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null && dragging !== name) move(dragging, index);
              }}
              onDragEnd={() => setDragging(null)}
              className={cn(
                'flex h-11 items-center gap-2 rounded-lg border bg-background px-2',
                dragging === name && 'opacity-50',
                isHidden && 'text-muted-foreground',
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">
                {ranked ? index + 1 : ''}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', isHidden && 'line-through')}>
                {name || t('manga.filters.noScanlator')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('manga.chapterCount', { count: counts.get(name) ?? 0 })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('manga.scanlators.moveUp')}
                disabled={index === 0}
                onClick={() => move(name, index - 1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('manga.scanlators.moveDown')}
                disabled={index === order.length - 1}
                onClick={() => move(name, index + 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                role="switch"
                aria-checked={!isHidden}
                aria-label={t('manga.scanlators.show', { name: name || t('manga.filters.noScanlator') })}
                title={isHidden ? t('manga.scanlators.hidden') : t('manga.scanlators.visible')}
                onClick={() => toggleHidden(name)}
              >
                {isHidden ? <EyeOff /> : <Eye />}
              </Button>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        {ranked ? t('manga.scanlators.priorityHint') : t('manga.scanlators.noPriorityHint')}
      </p>
      <div className="flex items-center gap-2">
        {ranked && (
          <Button variant="ghost" size="sm" onClick={() => setRanked(false)}>
            {t('manga.scanlators.clearOrder')}
          </Button>
        )}
        <Button variant="ghost" className="ml-auto" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate({ hidden: [...hidden], priority: ranked ? order : [] })}
        >
          {t('common.save')}
        </Button>
      </div>
    </>
  );
}
