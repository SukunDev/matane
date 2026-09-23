import type { Preference } from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { Dialog, Switch } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ipc } from '../../lib/ipc';
import { preferencesQuery, queryKeys } from '../../lib/sources';

/** Settings an extension declares via `preferences()`; values are stored by main per extension. */
export function PreferencesDialog({
  extensionId,
  name,
  open,
  onOpenChange,
}: {
  extensionId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({ ...preferencesQuery(extensionId), enabled: open });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl">
          <header className="flex items-center gap-3 border-b px-5 py-4">
            <Dialog.Title className="text-base font-semibold">
              {t('extensions.preferences.title', { name })}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="ml-auto" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{t('extensions.preferences.description')}</Dialog.Description>
          <div className="overflow-y-auto px-5 py-2">
            {query.isPending ? (
              <div className="flex justify-center p-8">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : query.isError ? (
              <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
            ) : query.data.definitions.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground">{t('extensions.preferences.none')}</p>
            ) : (
              <ul className="divide-y">
                {query.data.definitions.map((pref) => (
                  <PreferenceRow
                    key={pref.key}
                    extensionId={extensionId}
                    pref={pref}
                    value={query.data.values[pref.key]}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreferenceRow({ extensionId, pref, value }: { extensionId: string; pref: Preference; value: unknown }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: unknown) => ipc.invoke('extensions.setPreference', { extensionId, key: pref.key, value: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.preferences(extensionId) }),
  });
  const id = `pref-${extensionId}-${pref.key}`;

  return (
    <li className="flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="font-medium">
          {pref.label}
        </label>
        {pref.description && <p className="text-xs text-muted-foreground">{pref.description}</p>}
        {pref.type === 'text' && (
          <Input
            id={id}
            className="mt-2"
            defaultValue={typeof value === 'string' ? value : pref.default}
            onBlur={(event) => save.mutate(event.target.value)}
          />
        )}
        {pref.type === 'multiselect' && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {pref.options.map((option) => {
              const selected = Array.isArray(value) ? (value as string[]) : pref.default;
              return (
                <label key={option.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-(--app-accent)"
                    checked={selected.includes(option.value)}
                    onChange={(event) =>
                      save.mutate(
                        event.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value),
                      )
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        )}
      </div>
      {pref.type === 'switch' && (
        <Switch.Root
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => save.mutate(checked)}
          className="relative h-6 w-11 shrink-0 rounded-full bg-ctp-surface1 transition-colors data-[state=checked]:bg-primary"
        >
          <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground" />
        </Switch.Root>
      )}
      {pref.type === 'select' && (
        <select
          id={id}
          value={typeof value === 'string' ? value : pref.default}
          onChange={(event) => save.mutate(event.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-2.5"
        >
          {pref.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
