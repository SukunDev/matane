import { ImageOff, Loader2, RotateCw } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { pageSrc, usePageSizes } from './pages';

/**
 * One page from `manga://page/<chapterId>/<index>` (main fetches, caches and serves it). Reports its
 * natural size once decoded; a failed page can be retried in place.
 */
export function PageImage({
  chapterId,
  index,
  className,
  placeholderClassName,
  placeholderStyle,
  alt,
}: {
  chapterId: number;
  index: number;
  className?: string;
  /** Size of the box shown while loading or after an error. */
  placeholderClassName?: string;
  placeholderStyle?: CSSProperties;
  alt: string;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const setSize = usePageSizes((s) => s.set);

  return (
    <>
      {state !== 'failed' && (
        <img
          key={attempt}
          src={pageSrc(chapterId, index, attempt)}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            setSize(chapterId, index, { width: image.naturalWidth, height: image.naturalHeight });
            setState('loaded');
          }}
          onError={() => setState('failed')}
          className={cn(className, state === 'loading' && 'hidden')}
        />
      )}
      {state === 'loading' && (
        <div
          style={placeholderStyle}
          className={cn('flex items-center justify-center text-ctp-overlay1', placeholderClassName)}
        >
          <Loader2 className="size-8 animate-spin" aria-label={t('reader.loadingPage', { page: index + 1 })} />
        </div>
      )}
      {state === 'failed' && (
        <div
          style={placeholderStyle}
          className={cn(
            'flex flex-col items-center justify-center gap-3 text-center text-ctp-subtext0',
            placeholderClassName,
          )}
        >
          <ImageOff className="size-8" />
          <p>{t('reader.pageFailed', { page: index + 1 })}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setState('loading');
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw />
            {t('common.retry')}
          </Button>
        </div>
      )}
    </>
  );
}
