import type { ExtensionLogEntry } from '@manga-reader/shared';
import { Check, Copy, Trash2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ipc, useIpcEvent } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { Segmented } from '../settings/controls';

type LevelFilter = 'all' | 'info' | 'warn' | 'error';
const FILTERS: LevelFilter[] = ['all', 'info', 'warn', 'error'];
const RANK: Record<ExtensionLogEntry['level'], number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_RANK: Record<LevelFilter, number> = { all: 0, info: 1, warn: 2, error: 3 };
const LEVEL_CLASS: Record<ExtensionLogEntry['level'], string> = {
  debug: 'text-muted-foreground',
  info: 'text-ctp-blue',
  warn: 'text-ctp-yellow',
  error: 'text-ctp-red',
};

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false });
const format = (e: ExtensionLogEntry) => `${time(e.at)} ${e.level.toUpperCase().padEnd(5)} [${e.kind}] ${e.message}`;

/**
 * An extension's log (mockup 09 "View logs"): its own `log.*` lines, failed calls and HTTP
 * requests, the last 500 kept by main, new ones arriving live.
 */
export function LogDialog({
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
  const [entries, setEntries] = useState<ExtensionLogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [copied, setCopied] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void ipc.invoke('extensions.logs', { extensionId }).then((fetched) => {
      if (cancelled) return;
      // Lines that arrived live while fetching are kept, without doubles.
      setEntries((live) => [...fetched, ...live.filter((e) => e.seq > (fetched.at(-1)?.seq ?? 0))]);
    });
    return () => {
      cancelled = true;
      setEntries([]);
    };
  }, [open, extensionId]);

  useIpcEvent('extensions.log', (payload) => {
    if (!open || payload.extensionId !== extensionId) return;
    setEntries((current) => [...current, payload.entry].slice(-500));
  });

  const shown = entries.filter((e) => RANK[e.level] >= MIN_RANK[filter]);

  // Follow new lines while the list is scrolled to the end.
  useLayoutEffect(() => {
    if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length]);

  const copy = () => {
    void navigator.clipboard.writeText(shown.map(format).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const clear = () => {
    void ipc.invoke('extensions.clearLogs', { extensionId });
    setEntries([]);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(40rem,85vh)] w-[min(56rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl">
          <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
            <Dialog.Title className="mr-auto text-base font-semibold">
              {t('extensions.logs.title', { name })}
            </Dialog.Title>
            <Segmented
              label={t('extensions.logs.filter')}
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              format={(value) => t(`extensions.logs.levels.${value}`)}
            />
            <Button variant="ghost" size="sm" onClick={copy} disabled={shown.length === 0}>
              {copied ? <Check /> : <Copy />}
              {copied ? t('extensions.logs.copied') : t('extensions.logs.copy')}
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} disabled={entries.length === 0}>
              <Trash2 />
              {t('extensions.logs.clear')}
            </Button>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{t('extensions.logs.description')}</Dialog.Description>
          {shown.length === 0 ? (
            <p className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
              {t('extensions.logs.empty')}
            </p>
          ) : (
            <ol
              ref={list}
              aria-label={t('extensions.logs.lines')}
              onScroll={(event) => {
                const el = event.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-3 font-mono text-xs leading-relaxed select-text"
            >
              {shown.map((entry) => (
                <li key={entry.seq} className="flex gap-3 break-all whitespace-pre-wrap">
                  <span className="shrink-0 text-muted-foreground">{time(entry.at)}</span>
                  <span className={cn('w-12 shrink-0 font-semibold uppercase', LEVEL_CLASS[entry.level])}>
                    {entry.level}
                  </span>
                  <span className="w-10 shrink-0 text-muted-foreground">{entry.kind}</span>
                  <span className="min-w-0">{entry.message}</span>
                </li>
              ))}
            </ol>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
