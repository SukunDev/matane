import { ImageOff, Loader2, RotateCw } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { pageSrc, preparePage, segmentsOf, sizeKey, usePageSizes } from './pages';

/**
 * One page from `manga://page/<chapterId>/<index>` (main fetches, caches and serves it). Its size
 * comes from main first (`preparePage`); a tall page in a strip shows as stacked segments that
 * load as they come near. A failed page can be retried in place.
 */
export function PageImage({
  chapterId,
  index,
  crop,
  split = false,
  className,
  placeholderClassName,
  placeholderStyle,
  alt,
}: {
  chapterId: number;
  index: number;
  /** Cropped to its content (Crop borders). */
  crop: boolean;
  /** Tall pages as segments (webtoon and vertical modes with Split tall pages). */
  split?: boolean;
  className?: string;
  /** Size of the box shown while loading or after an error. */
  placeholderClassName?: string;
  placeholderStyle?: CSSProperties;
  alt: string;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const size = usePageSizes((s) => s.sizes[sizeKey(chapterId, index, crop)]);

  useEffect(() => {
    if (size && attempt === 0) return;
    let alive = true;
    preparePage(chapterId, index, crop, attempt).catch(() => alive && setState('failed'));
    return () => {
      alive = false;
    };
  }, [chapterId, index, crop, attempt, size]);

  const segments = size ? segmentsOf(size, split) : [];
  const retry = (event: React.MouseEvent) => {
    event.stopPropagation();
    setState('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <>
      {size && state !== 'failed' && segments.length === 1 && (
        <img
          key={attempt}
          src={pageSrc(chapterId, index, { crop }, attempt)}
          alt={alt}
          draggable={false}
          decoding="async"
          data-page={`${chapterId}:${index}`}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(className, state === 'loading' && 'hidden')}
        />
      )}
      {size && state !== 'failed' && segments.length > 1 && (
        <div
          key={attempt}
          role="img"
          aria-label={alt}
          data-page={`${chapterId}:${index}`}
          className={cn(className, state === 'loading' && 'hidden')}
        >
          {segments.map((height, n) => (
            <img
              key={n}
              src={pageSrc(chapterId, index, { crop, segment: n }, attempt)}
              alt=""
              draggable={false}
              decoding="async"
              loading={n === 0 ? 'eager' : 'lazy'}
              data-segment={n}
              onLoad={n === 0 ? () => setState('loaded') : undefined}
              onError={() => setState('failed')}
              style={{ aspectRatio: `${size.width} / ${height}` }}
              className="block h-auto w-full"
            />
          ))}
        </div>
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
          <Button variant="secondary" size="sm" onClick={retry}>
            <RotateCw />
            {t('common.retry')}
          </Button>
        </div>
      )}
    </>
  );
}
