import { useMutation } from '@tanstack/react-query';
import { Copy, Download, ImageUp } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../../lib/ipc';
import { useReaderNotice } from './notice';

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

const itemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-ctp-surface0';

/** Right-click a page → save it, copy it, or make it the cover (docs/BRAINSTORM.md §6.1). Elsewhere no menu opens. */
export function PageContextMenu({ mangaId, children }: { mangaId: number; children: ReactNode }) {
  const { t } = useTranslation();
  const notify = useReaderNotice((state) => state.show);
  const [page, setPage] = useState<PageRef>();
  const setCover = useMutation({
    mutationFn: (ref: PageRef) => ipc.invoke('manga.setCustomCover', { mangaId, from: { kind: 'page', ...ref } }),
    onSuccess: () => notify(t('reader.coverSet')),
    onError: () => notify(t('reader.coverFailed')),
  });
  const savePage = useMutation({
    mutationFn: (ref: PageRef) => ipc.invoke('reader.savePage', ref),
    onSuccess: (path) => path && notify(t('reader.pageSaved')),
    onError: () => notify(t('reader.pageSaveFailed')),
  });
  const copyPage = useMutation({
    mutationFn: (ref: PageRef) => ipc.invoke('reader.copyPage', ref),
    onSuccess: () => notify(t('reader.pageCopied')),
    onError: () => notify(t('reader.pageCopyFailed')),
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
          <ContextMenu.Item className={itemClass} onSelect={() => page && savePage.mutate(page)}>
            <Download className="size-4" />
            {t('reader.savePage')}
          </ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onSelect={() => page && copyPage.mutate(page)}>
            <Copy className="size-4" />
            {t('reader.copyPage')}
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-ctp-surface1" />
          <ContextMenu.Item className={itemClass} onSelect={() => page && setCover.mutate(page)}>
            <ImageUp className="size-4" />
            {t('reader.setAsCover', { page: (page?.index ?? 0) + 1 })}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
