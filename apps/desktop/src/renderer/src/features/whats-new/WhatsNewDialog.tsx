import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import changelog from '../../../../../../../CHANGELOG.md?raw';
import { Button } from '../../components/ui/button';
import { ipc, settingsQuery } from '../../lib/ipc';
import { type Block, inline, releaseNotes } from './changelog';

interface WhatsNewState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Open from Settings → About too. */
export const useWhatsNew = create<WhatsNewState>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const whatsNewQuery = { queryKey: ['app', 'whatsNew'], queryFn: () => ipc.invoke('app.whatsNew') } as const;

/**
 * What's new (docs/BRAINSTORM.md §6.6): after an update, the release notes of the running version
 * show once (from the bundled changelog, so offline too). Not on a new profile, which goes through
 * the first-run setup instead.
 */
export function WhatsNewDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { open, setOpen } = useWhatsNew();
  const { data: state } = useQuery(whatsNewQuery);
  const { data: settings } = useQuery(settingsQuery);
  const notes = useMemo(() => (state ? releaseNotes(changelog, state.version) : null), [state]);

  useEffect(() => {
    if (!state || state.seen || !settings?.onboarding.done) return;
    if (notes) setOpen(true);
    // Nothing written for this version: nothing to show, later versions still will.
    else void ipc.invoke('app.whatsNewSeen').then(() => queryClient.invalidateQueries(whatsNewQuery));
  }, [state, notes, settings?.onboarding.done, setOpen, queryClient]);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next && state && !state.seen) {
      void ipc.invoke('app.whatsNewSeen').then(() => queryClient.invalidateQueries(whatsNewQuery));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ctp-crust/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl"
        >
          <header className="flex items-start gap-3 border-b p-5">
            <Sparkles className="mt-0.5 size-5 text-primary" />
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold">{t('whatsNew.title')}</Dialog.Title>
              {notes && (
                <p className="text-sm text-muted-foreground">
                  {t('whatsNew.version', { version: notes.version, date: notes.date })}
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm leading-relaxed">
            {notes ? <Notes blocks={notes.blocks} /> : <p className="text-muted-foreground">{t('whatsNew.none')}</p>}
          </div>
          <footer className="flex justify-end border-t p-4">
            <Dialog.Close asChild>
              <Button>{t('whatsNew.done')}</Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Notes({ blocks }: { blocks: Block[] }) {
  // Consecutive items form one list.
  const groups: Block[][] = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (block.kind === 'item' && last?.[0]?.kind === 'item') last.push(block);
    else groups.push([block]);
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, i) => {
        const first = group[0]!;
        if (first.kind === 'heading') {
          return (
            <h3 key={i} className="mt-2 font-semibold">
              <Text text={first.text} />
            </h3>
          );
        }
        if (first.kind === 'paragraph') {
          return (
            <p key={i}>
              <Text text={first.text} />
            </p>
          );
        }
        return (
          <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-primary">
            {group.map((item, j) => (
              <li key={j}>
                <Text text={item.text} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function Text({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((part, i) =>
        part.kind === 'code' ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">
            {part.text}
          </code>
        ) : part.kind === 'strong' ? (
          <strong key={i}>{part.text}</strong>
        ) : part.kind === 'link' ? (
          // Opens in the browser (the window's open handler).
          <a key={i} href={part.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
