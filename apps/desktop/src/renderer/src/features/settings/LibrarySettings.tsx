import type { Category } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ipc } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { cn } from '../../lib/utils';

/** Settings → Library: the user's categories (create, rename, delete, drag to reorder). */
export function LibrarySettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const create = useMutation({
    mutationFn: (value: string) => ipc.invoke('categories.create', { name: value }),
    onSuccess: () => setName(''),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => ipc.invoke('categories.reorder', { ids }),
    onMutate: (ids) => {
      // Optimistic, so the row doesn't jump back until main confirms.
      const byId = new Map(categories.map((c) => [c.id, c]));
      queryClient.setQueryData(
        categoriesQuery.queryKey,
        ids.flatMap((id, sortOrder) => {
          const category = byId.get(id);
          return category ? [{ ...category, sortOrder }] : [];
        }),
      );
    },
  });

  const drop = (targetId: number) => {
    if (dragging === null || dragging === targetId) return;
    const ids = categories.map((c) => c.id).filter((id) => id !== dragging);
    ids.splice(
      ids.indexOf(targetId) + (indexOf(categories, dragging) < indexOf(categories, targetId) ? 1 : 0),
      0,
      dragging,
    );
    reorder.mutate(ids);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="text-sm font-semibold">{t('settings.library.categories')}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('settings.library.categoriesHint')}</p>
      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t('library.categories.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={t('settings.library.categories')}>
          {categories.map((category) => (
            <li
              key={category.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                setDragging(category.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(category.id);
              }}
              onDragLeave={() => setOver((current) => (current === category.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                drop(category.id);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                'rounded-lg border bg-background transition-colors',
                dragging === category.id && 'opacity-50',
                over === category.id && dragging !== category.id && 'border-primary',
              )}
            >
              <CategoryRow category={category} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <Input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('library.categories.newPlaceholder')}
          aria-label={t('library.categories.newPlaceholder')}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus />
          {t('library.categories.create')}
        </Button>
      </form>
    </section>
  );
}

const indexOf = (categories: Category[], id: number) => categories.findIndex((c) => c.id === id);

function CategoryRow({ category }: { category: Category }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rename = useMutation({
    mutationFn: (name: string) => ipc.invoke('categories.rename', { id: category.id, name }),
    onSuccess: () => setEditing(false),
  });
  const remove = useMutation({ mutationFn: () => ipc.invoke('categories.delete', { id: category.id }) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) rename.mutate(draft.trim());
  };

  return (
    <div className="flex h-11 items-center gap-2 px-2">
      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
      {editing ? (
        <form onSubmit={submit} className="flex flex-1 items-center gap-1">
          <Input
            autoFocus
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
            aria-label={t('settings.library.rename')}
            className="h-8"
          />
          <Button type="submit" variant="ghost" size="icon" title={t('common.save')} disabled={!draft.trim()}>
            <Check />
          </Button>
          <Button variant="ghost" size="icon" title={t('common.cancel')} onClick={() => setEditing(false)}>
            <X />
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
          <span className="text-xs text-muted-foreground">{t('library.titles', { count: category.count })}</span>
          <Button
            variant="ghost"
            size="icon"
            title={t('settings.library.rename')}
            onClick={() => {
              setDraft(category.name);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('settings.library.delete')}
            className="hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('settings.library.deleteTitle', { name: category.name })}
        description={t('settings.library.deleteDescription')}
        confirmLabel={t('settings.library.delete')}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
