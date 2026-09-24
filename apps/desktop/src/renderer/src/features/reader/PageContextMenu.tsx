import { useMutation } from '@tanstack/react-query';
import { ImageUp } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../../lib/ipc';

interface PageRef {
  chapterId: number;
  index: number;
}

/** The page image under the pointer (`data-page="<chapterId>:<index>"` on PageImage). */
function pageAt(target: EventTarget | null): PageRef | undefined {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-page]') : null;
  const [chapterId, index] = (element?.dataset['page'] ?? '').split(':').map(Number);
  return chapterId !== undefined && index !== undefined && chapterId > 0 && index >= 0
    ? { chapterId, index }
    : undefined;
}

/** Right-click a page → "Set as cover" (BRAINSTORM.md §6.2). Elsewhere no menu opens. */
export function PageContextMenu({ mangaId, children }: { mangaId: number; children: ReactNode }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageRef>();
  const [notice, setNotice] = useState<'set' | 'failed' | null>(null);
  const flash = (value: 'set' | 'failed') => {
    setNotice(value);
    setTimeout(() => setNotice(null), 2500);
  };
  const setCover = useMutation({
    mutationFn: (ref: PageRef) => ipc.invoke('manga.setCustomCover', { mangaId, from: { kind: 'page', ...ref } }),
    onSuccess: () => flash('set'),
    onError: () => flash('failed'),
  });

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(event) => {
          const ref = pageAt(event.target);
          // Radix skips opening when the event is already handled.
          if (!ref) event.preventDefault();
          setPage(ref);
        }}
      >
        <div className="h-full">{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-48 rounded-lg border border-ctp-surface1 bg-ctp-mantle p-1 text-ctp-text shadow-xl">
          <ContextMenu.Item
            className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-ctp-surface0"
            onSelect={() => page && setCover.mutate(page)}
          >
            <ImageUp className="size-4" />
            {t('reader.setAsCover', { page: (page?.index ?? 0) + 1 })}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
      {notice && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-ctp-crust/90 px-4 py-2 text-sm text-ctp-text shadow-lg"
        >
          {notice === 'failed' ? t('reader.coverFailed') : t('reader.coverSet')}
        </div>
      )}
    </ContextMenu.Root>
  );
}
