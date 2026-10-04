import type { MangaInfo } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BookmarkCheck,
  BookmarkMinus,
  BookmarkPlus,
  ChevronDown,
  EllipsisVertical,
  Folder,
  ImagePlus,
  ImageOff,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoverImage } from '../../components/CoverImage';
import { Button } from '../../components/ui/button';
import { useErrorText } from '../../lib/errors';
import { ipc } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { sourcesQuery } from '../../lib/sources';
import { CategoryDialog } from '../library/CategoryDialog';

const menuClass = 'z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl';
const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent';

/**
 * "Add to library" (duplicate check → categories → add) or, once added, "In library ▾" to edit the
 * categories or remove it (docs/BRAINSTORM.md §6.2).
 */
export function LibraryButton({ manga }: { manga: MangaInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [duplicates, setDuplicates] = useState<MangaInfo[]>([]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const add = useMutation({
    mutationFn: (categoryIds: number[]) => ipc.invoke('library.add', { mangaId: manga.id, categoryIds }),
  });
  const setCategories = useMutation({
    mutationFn: (categoryIds: number[]) => ipc.invoke('library.setCategories', { mangaIds: [manga.id], categoryIds }),
  });
  const remove = useMutation({ mutationFn: () => ipc.invoke('library.remove', { mangaIds: [manga.id] }) });

  // Without categories there is nothing to choose: add straight to "Default".
  const chooseCategories = async () => {
    const categories = await queryClient.fetchQuery(categoriesQuery);
    if (categories.length === 0) add.mutate([]);
    else setCategoriesOpen(true);
  };
  const start = useMutation({
    mutationFn: () => ipc.invoke('manga.findDuplicates', { mangaId: manga.id }),
    onSuccess: (found) => {
      if (found.length > 0) setDuplicates(found);
      else void chooseCategories();
    },
  });
  const busy = add.isPending || start.isPending;
  const error = add.error ?? start.error ?? remove.error ?? setCategories.error;

  return (
    <>
      {manga.inLibrary ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="secondary" className="h-10 border-primary/50 text-primary">
              <BookmarkCheck className="fill-current/20" />
              {t('library.inLibrary')}
              <ChevronDown />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={6} className={menuClass}>
              <DropdownMenu.Item className={menuItem} onSelect={() => setCategoriesOpen(true)}>
                <Folder className="size-4" />
                {t('library.editCategories')}
              </DropdownMenu.Item>
              <DropdownMenu.Item className={`${menuItem} text-destructive`} onSelect={() => setConfirmRemove(true)}>
                <BookmarkMinus className="size-4" />
                {t('library.removeOne')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <Button variant="secondary" className="h-10" disabled={busy} onClick={() => start.mutate()}>
          {busy ? <Loader2 className="animate-spin" /> : <BookmarkPlus />}
          {t('library.add')}
        </Button>
      )}
      {error !== null && <ActionError error={error} />}

      <CategoryDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        title={manga.inLibrary ? t('library.editCategories') : t('library.addTo')}
        initial={manga.categoryIds}
        confirmLabel={manga.inLibrary ? t('common.save') : t('library.add')}
        onConfirm={(categoryIds) => (manga.inLibrary ? setCategories.mutate(categoryIds) : add.mutate(categoryIds))}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('library.remove.title', { count: 1 })}
        description={t('library.remove.description')}
        confirmLabel={t('library.remove.confirm')}
        onConfirm={() => remove.mutate()}
      />
      <DuplicateDialog
        duplicates={duplicates}
        onClose={() => setDuplicates([])}
        onAddAnyway={() => {
          setDuplicates([]);
          void chooseCategories();
        }}
      />
    </>
  );
}

/** Warns that the same title is already in the library from another source. */
function DuplicateDialog({
  duplicates,
  onClose,
  onAddAnyway,
}: {
  duplicates: MangaInfo[];
  onClose: () => void;
  onAddAnyway: () => void;
}) {
  const { t } = useTranslation();
  const { data: sources = [] } = useQuery(sourcesQuery);
  return (
    <Dialog.Root open={duplicates.length > 0} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(30rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
            <TriangleAlert className="size-5 text-ctp-peach" />
            {t('library.duplicate.title')}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground">
            {t('library.duplicate.description')}
          </Dialog.Description>
          <ul className="flex flex-col gap-2">
            {duplicates.map((other) => (
              <li key={other.id}>
                <Link
                  to="/manga/$mangaId"
                  params={{ mangaId: String(other.id) }}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-lg border p-2 transition-colors hover:border-primary"
                >
                  <CoverImage
                    mangaId={other.id}
                    coverKey={other.coverKey}
                    alt={other.title}
                    className="aspect-[2/3] h-14 shrink-0 rounded"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{other.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {sources.find((s) => s.id === other.sourceId)?.name ?? other.sourceId}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onAddAnyway}>{t('library.duplicate.addAnyway')}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "⋮" on the detail page: custom cover from a file, or back to the source's cover. */
export function MoreMenu({ manga }: { manga: MangaInfo }) {
  const { t } = useTranslation();
  const setCover = useMutation({
    mutationFn: () => ipc.invoke('manga.setCustomCover', { mangaId: manga.id, from: { kind: 'file' } }),
  });
  const resetCover = useMutation({ mutationFn: () => ipc.invoke('manga.resetCover', { mangaId: manga.id }) });
  const error = setCover.error ?? resetCover.error;
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="secondary" size="icon" className="size-10" title={t('manga.moreActions')}>
            <EllipsisVertical />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={6} className={menuClass}>
            <DropdownMenu.Item className={menuItem} onSelect={() => setCover.mutate()}>
              <ImagePlus className="size-4" />
              {t('manga.cover.change')}
            </DropdownMenu.Item>
            {manga.hasCustomCover && (
              <DropdownMenu.Item className={menuItem} onSelect={() => resetCover.mutate()}>
                <ImageOff className="size-4" />
                {t('manga.cover.reset')}
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error !== null && <ActionError error={error} />}
    </>
  );
}

function ActionError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <p role="alert" className="basis-full text-xs text-destructive" title={detail}>
      {title}: {detail}
    </p>
  );
}
