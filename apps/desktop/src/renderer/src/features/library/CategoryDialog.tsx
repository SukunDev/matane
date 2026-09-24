import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ipc } from '../../lib/ipc';
import { categoriesQuery } from '../../lib/library';
import { cn } from '../../lib/utils';

/**
 * Picks the categories of one or more manga (BRAINSTORM.md §6.2). None checked = "Default".
 * New categories can be created inline and start checked.
 */
export function CategoryDialog({
  open,
  onOpenChange,
  title,
  initial,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: readonly number[];
  confirmLabel: string;
  onConfirm: (categoryIds: number[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(26rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl">
          <header className="flex items-center gap-3 border-b px-5 py-4">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="ml-auto" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{t('library.categories.dialogHint')}</Dialog.Description>
          {/* Mounted per opening, so the checkboxes start from `initial` every time. */}
          <CategoryPicker
            initial={initial}
            confirmLabel={confirmLabel}
            onConfirm={(ids) => {
              onConfirm(ids);
              onOpenChange(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoryPicker({
  initial,
  confirmLabel,
  onConfirm,
}: {
  initial: readonly number[];
  confirmLabel: string;
  onConfirm: (categoryIds: number[]) => void;
}) {
  const { t } = useTranslation();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set(initial));
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => ipc.invoke('categories.create', { name: value }),
    onSuccess: (category) => {
      setChecked((current) => new Set(current).add(category.id));
      setName('');
    },
  });
  const toggle = (id: number) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  return (
    <>
      <div className="flex flex-col gap-1 overflow-y-auto px-3 py-3">
        {categories.length === 0 && (
          <p className="px-2 py-3 text-center text-muted-foreground">{t('library.categories.none')}</p>
        )}
        {categories.map((category) => {
          const on = checked.has(category.id);
          return (
            <button
              key={category.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(category.id)}
              className="flex h-9 items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-accent"
            >
              <span
                className={cn(
                  'flex size-4.5 items-center justify-center rounded border border-input',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {on && <Check className="size-3.5" />}
              </span>
              <span className="truncate">{category.name}</span>
            </button>
          );
        })}
        <form onSubmit={submit} className="mt-1 flex gap-2 px-2">
          <Input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('library.categories.newPlaceholder')}
            aria-label={t('library.categories.newPlaceholder')}
            className="h-8"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!name.trim() || create.isPending}>
            <Plus />
            {t('library.categories.create')}
          </Button>
        </form>
      </div>
      <footer className="flex items-center gap-2 border-t px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {checked.size === 0
            ? t('library.categories.defaultHint')
            : t('library.categories.selected', { count: checked.size })}
        </p>
        <Button className="ml-auto" onClick={() => onConfirm([...checked])}>
          {confirmLabel}
        </Button>
      </footer>
    </>
  );
}
