import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';

interface CoverImageProps {
  mangaId: number;
  /** Changes whenever the cover does (custom cover path or source cover URL); null = no cover. */
  coverKey: string | null;
  alt: string;
  className?: string;
}

/** Short, stable hash so the `manga://` URL changes when the cover changes. */
function version(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (Math.imul(hash, 31) + url.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function coverSrc(mangaId: number, coverKey: string): string {
  return `manga://cover/${mangaId}?v=${version(coverKey)}`;
}

/**
 * Manga cover served by main over `manga://cover/<id>` (cached, fetched with the source's headers);
 * the renderer never loads remote images itself (BRAINSTORM.md §6.5).
 */
export function CoverImage(props: CoverImageProps) {
  // Remount on a new cover URL so the load state starts over (e.g. details just filled it in).
  return <Cover key={props.coverKey ?? ''} {...props} />;
}

function Cover({ mangaId, coverKey, alt, className }: CoverImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(coverKey ? 'loading' : 'failed');
  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {coverKey && state !== 'failed' && (
        <img
          src={coverSrc(mangaId, coverKey)}
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
