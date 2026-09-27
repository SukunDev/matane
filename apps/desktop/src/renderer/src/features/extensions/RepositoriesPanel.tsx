import type { AddRepoResult, RepoInfo } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Copy,
  EllipsisVertical,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useErrorText } from '../../lib/errors';
import { reposQuery, useSyncRepos } from '../../lib/extensions';
import { formatRelative } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { TrustBadge } from './parts';

const menuItem =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4';

/** The Repositories side panel (mockup 09): trust, sync, trust a key, remove, add. */
export function RepositoriesPanel({ onClose, now }: { onClose: () => void; now: number }) {
  const { t } = useTranslation();
  const { data: repos = [] } = useQuery(reposQuery);
  const [adding, setAdding] = useState(false);

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-sidebar"
      aria-label={t('extensions.repos.title')}
      data-testid="repositories-panel"
    >
      <header className="flex items-center gap-2 border-b px-4 py-4">
        <Server className="size-4 text-muted-foreground" />
        <h2 className="flex-1 font-semibold">{t('extensions.repos.title')}</h2>
        <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {repos.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">{t('extensions.repos.none')}</p>
        )}
        {repos.map((repo) => (
          <RepoCard key={repo.id} repo={repo} now={now} />
        ))}
      </div>
      <div className="border-t p-4">
        <Button variant="secondary" className="w-full border-dashed" onClick={() => setAdding(true)}>
          <Plus />
          {t('extensions.repos.add')}
        </Button>
      </div>
      <AddRepoDialog open={adding} onOpenChange={setAdding} />
    </aside>
  );
}

function RepoCard({ repo, now }: { repo: RepoInfo; now: number }) {
  const { t, i18n } = useTranslation();
  const sync = useSyncRepos();
  const trust = useMutation({ mutationFn: () => ipc.invoke('repos.trustKey', { repoId: repo.id }) });
  const remove = useMutation({ mutationFn: () => ipc.invoke('repos.remove', { repoId: repo.id }) });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmTrust, setConfirmTrust] = useState(false);

  return (
    <article className="rounded-xl border bg-card/40 p-3.5" aria-label={repo.name} data-testid="repo-card">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 truncate font-medium" title={repo.url}>
          {repo.name}
        </h3>
        <TrustBadge trust={repo.trust} />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t('extensions.repos.sync')}
          onClick={() => sync.mutate(repo.id)}
          disabled={sync.isPending}
        >
          <RefreshCw className={cn(sync.isPending && 'animate-spin')} />
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="icon" className="size-7" title={t('extensions.repos.more')}>
              <EllipsisVertical />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              {repo.problem === 'unknown-key' && (
                <DropdownMenu.Item className={menuItem} onSelect={() => setConfirmTrust(true)}>
                  <KeyRound />
                  {t('extensions.repos.trustKey')}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item className={menuItem} onSelect={() => void navigator.clipboard.writeText(repo.url)}>
                <Copy />
                {t('extensions.repos.copyUrl')}
              </DropdownMenu.Item>
              <DropdownMenu.Item className={cn(menuItem, 'text-destructive')} onSelect={() => setConfirmRemove(true)}>
                <Trash2 />
                {t('extensions.repos.remove')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t('extensions.repos.count', { count: repo.extensionCount })}
        {repo.lastSyncedAt !== null && (
          <> · {t('extensions.repos.synced', { when: formatRelative(repo.lastSyncedAt, i18n.language, now) })}</>
        )}
      </p>
      {repo.problem && (
        <p className="mt-1.5 text-xs text-ctp-yellow">{t(`extensions.repos.problem.${repo.problem}`)}</p>
      )}
      {repo.lastError && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ctp-red select-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {repo.lastError}
        </p>
      )}
      {(trust.error ?? remove.error) && <MutationError error={trust.error ?? remove.error} />}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('extensions.repos.removeTitle', { name: repo.name })}
        description={t('extensions.repos.removeDescription')}
        confirmLabel={t('extensions.repos.remove')}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={confirmTrust}
        onOpenChange={setConfirmTrust}
        title={t('extensions.repos.trustTitle', { name: repo.name })}
        description={
          <>
            {t('extensions.repos.trustDescription')}
            <code className="mt-2 block rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground">
              {repo.signedBy}
            </code>
          </>
        }
        confirmLabel={t('extensions.repos.trustKey')}
        destructive={false}
        onConfirm={() => trust.mutate()}
      />
    </article>
  );
}

function MutationError({ error }: { error: unknown }) {
  const { title, detail } = useErrorText(error);
  return (
    <p className="mt-1.5 text-xs text-ctp-red select-text">
      {title}: {detail}
    </p>
  );
}

/** Asks for a URL; an unverified repository is only added after a warning is accepted. */
function AddRepoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<Extract<AddRepoResult, { status: 'needs-confirmation' }> | null>(null);
  const add = useMutation({
    mutationFn: (confirmUnverified: boolean) => ipc.invoke('repos.add', { url, confirmUnverified }),
    onSuccess: (result) => {
      if (result.status === 'needs-confirmation') {
        setPending(result);
        return;
      }
      change(false);
    },
  });
  const change = (next: boolean) => {
    if (!next) {
      setUrl('');
      setPending(null);
      add.reset();
    }
    onOpenChange(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) add.mutate(pending !== null);
  };

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t('extensions.repos.addTitle')}</Dialog.Title>
          <Dialog.Description className="text-muted-foreground">
            {t('extensions.repos.addDescription')}
          </Dialog.Description>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Input
              autoFocus
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setPending(null);
              }}
              placeholder="https://example.github.io/extensions/"
              aria-label={t('extensions.repos.url')}
              spellCheck={false}
            />
            {pending && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-ctp-yellow/40 bg-ctp-yellow/10 px-3 py-2.5 text-ctp-yellow"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {t('extensions.repos.unverifiedTitle', { name: pending.name, count: pending.extensionCount })}
                  </p>
                  <p className="text-xs">
                    {pending.problem && t(`extensions.repos.problem.${pending.problem}`)}{' '}
                    {t('extensions.repos.unverifiedWarning')}
                  </p>
                </div>
              </div>
            )}
            {add.error && <MutationError error={add.error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => change(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!url.trim() || add.isPending}>
                {add.isPending && <Loader2 className="animate-spin" />}
                {pending ? t('extensions.repos.addAnyway') : t('extensions.repos.addButton')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
