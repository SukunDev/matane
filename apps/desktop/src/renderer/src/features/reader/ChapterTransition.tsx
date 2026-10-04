import type { ChapterInfo } from '@manga-reader/shared';
import { AlertTriangle, CheckCircle2, ChevronsDown, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { missingBetween } from './navigation';

/**
 * Between chapters: what was finished, what comes next, and a warning when chapter numbers jump
 * (docs/BRAINSTORM.md §6.1). `continuous` is the inline divider of webtoon mode.
 */
export function ChapterTransition({
  from,
  to,
  direction,
  continuous,
  onGo,
  onExit,
  className,
}: {
  from: ChapterInfo;
  to: ChapterInfo | undefined;
  direction: 'next' | 'prev';
  continuous?: boolean;
  onGo?: () => void;
  onExit?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const missing = to ? missingBetween(from, to) : 0;
  const label = (chapter: ChapterInfo) => chapter.name + (chapter.scanlator ? ` · ${chapter.scanlator}` : '');

  return (
    <div className={cn('flex items-center justify-center p-6', className)}>
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-ctp-surface1 bg-ctp-mantle/90 p-6 text-center text-ctp-text shadow-xl">
        <span className="flex items-center gap-1.5 rounded-full bg-ctp-surface0 px-3 py-1 text-xs text-ctp-subtext1">
          <CheckCircle2 className="size-3.5 text-ctp-green" />
          {direction === 'next'
            ? t('reader.transition.finished', { chapter: from.name })
            : t('reader.transition.start', { chapter: from.name })}
        </span>
        {to ? (
          <>
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-primary uppercase">
                {direction === 'next' ? t('reader.transition.upNext') : t('reader.transition.previous')}
              </p>
              <p className="mt-1 text-lg font-semibold">{label(to)}</p>
            </div>
            {missing > 0 && (
              <p className="flex items-center gap-2 rounded-lg bg-ctp-peach/10 px-3 py-2 text-xs text-ctp-peach">
                <AlertTriangle className="size-4 shrink-0" />
                {t('reader.transition.missing', { count: missing })}
              </p>
            )}
            {continuous ? (
              <p className="flex items-center gap-1 text-xs text-ctp-subtext0">
                <ChevronsDown className="size-4" />
                {t('reader.transition.continues')}
              </p>
            ) : (
              <Button onClick={onGo}>
                {direction === 'next' ? <SkipForward /> : <SkipBack />}
                {direction === 'next' ? t('reader.nextChapter') : t('reader.prevChapter')}
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ctp-subtext0">
              {direction === 'next' ? t('reader.transition.noNext') : t('reader.transition.noPrev')}
            </p>
            {onExit && (
              <Button variant="secondary" onClick={onExit}>
                {t('reader.backToManga')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
