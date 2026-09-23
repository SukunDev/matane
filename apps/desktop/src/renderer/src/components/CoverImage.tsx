import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';

interface CoverImageProps {
  mangaId: number;
  /** The source's cover URL; null when the source has none (yet). */
  thumbnailUrl: string | null;
  alt: string;
  className?: string;
}

/** Short, stable hash so the `manga://` URL changes when the source changes the cover. */
function version(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (Math.imul(hash, 31) + url.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function coverSrc(mangaId: number, thumbnailUrl: string): string {
  return `manga://cover/${mangaId}?v=${version(thumbnailUrl)}`;
}

/**
 * Manga cover served by main over `manga://cover/<id>` (cached, fetched with the source's headers);
 * the renderer never loads remote images itself (BRAINSTORM.md §6.5).
 */
export function CoverImage(props: CoverImageProps) {
  // Remount on a new cover URL so the load state starts over (e.g. details just filled it in).
  return <Cover key={props.thumbnailUrl ?? ''} {...props} />;
}

function Cover({ mangaId, thumbnailUrl, alt, className }: CoverImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(thumbnailUrl ? 'loading' : 'failed');
  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {thumbnailUrl && state !== 'failed' && (
        <img
          src={coverSrc(mangaId, thumbnailUrl)}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn('size-full object-cover transition-opacity', state === 'loaded' ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {state === 'loading' && <div aria-hidden className="absolute inset-0 animate-pulse bg-muted" />}
      {state === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" />
        </div>
      )}
    </div>
  );
}
