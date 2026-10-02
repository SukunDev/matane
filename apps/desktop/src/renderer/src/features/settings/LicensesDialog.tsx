import { useQuery } from '@tanstack/react-query';
import { Scale, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ipc } from '../../lib/ipc';

const licensesQuery = {
  queryKey: ['app', 'licenses'],
  queryFn: () => ipc.invoke('app.licenses'),
  staleTime: Infinity,
} as const;

/** The open source packages inside the app and their licenses, written at build time. */
export function LicensesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { data: licenses = [], isPending } = useQuery({ ...licensesQuery, enabled: open });
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle
      ? licenses.filter((l) => l.name.toLowerCase().includes(needle) || l.license.toLowerCase().includes(needle))
      : licenses;
  }, [licenses, filter]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ctp-crust/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[80vh] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl"
        >
          <header className="flex items-start gap-3 border-b p-5">
            <Scale className="mt-0.5 size-5 text-primary" />
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold">{t('settings.about.licensesTitle')}</Dialog.Title>
              <p className="text-sm text-muted-foreground">
                {t('settings.about.licensesCount', { count: licenses.length })}
              </p>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <div className="border-b p-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('settings.about.licensesFilter')}
              aria-label={t('settings.about.licensesFilter')}
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="licenses">
            {!isPending && licenses.length === 0 && (
              <li className="p-2 text-sm text-muted-foreground">{t('settings.about.licensesNone')}</li>
            )}
            {shown.map((entry) => (
              <li key={`${entry.name}@${entry.version}`}>
                <details className="group rounded-lg px-2 py-1.5 open:bg-muted/40">
                  <summary className="flex cursor-pointer items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {entry.name} <span className="font-normal text-muted-foreground">{entry.version}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{entry.license}</span>
                  </summary>
                  {entry.repository && (
                    <a
                      href={entry.repository}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-xs text-primary hover:underline"
                    >
                      {entry.repository}
                    </a>
                  )}
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-background/60 p-3 text-xs whitespace-pre-wrap">
                    {entry.text ?? t('settings.about.licenseNoText', { license: entry.license })}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
