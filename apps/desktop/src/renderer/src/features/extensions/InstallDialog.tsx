import type { InstallPreview } from '@manga-reader/shared';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CircleCheck,
  Download,
  Globe,
  Info,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useErrorText } from '../../lib/errors';
import { repoIconUrl } from '../../lib/extensions';
import { formatBytes } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { ExtensionIcon } from './parts';

/** What to install: prepared here from a repository entry, or a preview main already prepared. */
export type InstallRequest =
  | {
      kind: 'prepare';
      repoId: number;
      extensionId: string;
      name: string;
      /** An update that reaches no new domain installs without asking. */
      update?: boolean;
    }
  | { kind: 'preview'; preview: InstallPreview };

/**
 * The install dialog (mockup 09b): downloads and verifies the archive first (main does it; nothing
 * is installed yet), then shows the repository's trust, the domains the extension may reach (new
 * ones marked on updates), its API version, size and that the SHA-256 matched the signed index.
 */
export function InstallDialog({ request, onClose }: { request: InstallRequest | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const prepare = useMutation({
    mutationFn: (input: { repoId: number; extensionId: string }) => ipc.invoke('extensions.prepareInstall', input),
  });
  const install = useMutation({ mutationFn: (token: string) => ipc.invoke('extensions.install', { token }) });
  const { mutate: prepareMutate, reset: resetPrepare } = prepare;
  const { mutate: installMutate, reset: resetInstall } = install;
  // The parent's callback may change every render; only a new request restarts the flow.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // A new request starts over.
  useEffect(() => {
    resetPrepare();
    resetInstall();
    if (request?.kind !== 'prepare') return;
    prepareMutate(
      { repoId: request.repoId, extensionId: request.extensionId },
      {
        onSuccess: (preview) => {
          if (request.update && preview.newDomains.length === 0) {
            installMutate(preview.token, { onSuccess: () => onCloseRef.current() });
          }
        },
      },
    );
  }, [request, prepareMutate, resetPrepare, installMutate, resetInstall]);

  const preview = request?.kind === 'preview' ? request.preview : (prepare.data ?? null);
  const installed = useRef(false);
  const close = () => {
    // Drop the downloaded archive if the user walked away.
    if (preview && !installed.current) void ipc.invoke('extensions.cancelInstall', { token: preview.token });
    installed.current = false;
    onClose();
  };
  const confirm = () => {
    if (!preview) return;
    installed.current = true;
    installMutate(preview.token, { onSuccess: onClose });
  };

  const name = preview?.name ?? (request?.kind === 'prepare' ? request.name : '');
  const isUpdate = preview ? preview.currentVersion !== null : request?.kind === 'prepare' && request.update;
  const error = prepare.error ?? install.error;
  const autoUpdating = request?.kind === 'prepare' && request.update && preview?.newDomains.length === 0;

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-2xl">
          <header className="flex items-center gap-3 border-b px-5 py-4">
            {request && (
              <ExtensionIcon
                id={preview?.id ?? (request.kind === 'prepare' ? request.extensionId : '')}
                name={name}
                src={preview?.hasIcon ? repoIconUrl(preview.repoId, preview.id) : null}
                className="size-11"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Dialog.Title className="truncate text-base font-semibold">{name}</Dialog.Title>
                {preview && (
                  <Badge className="font-mono">{t('extensions.version', { version: preview.version })}</Badge>
                )}
              </div>
              {preview && <RepoLine preview={preview} />}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" title={t('common.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{t('extensions.install.description')}</Dialog.Description>

          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {error ? (
              <InstallError error={error} />
            ) : !preview || autoUpdating ? (
              <p className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                {autoUpdating ? t('extensions.install.updating') : t('extensions.install.verifying')}
              </p>
            ) : (
              <>
                {preview.trust === 'unverified' && (
                  <p className="flex items-start gap-2.5 rounded-lg border border-ctp-yellow/40 bg-ctp-yellow/10 px-3 py-2.5 text-ctp-yellow">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {t('extensions.install.unverifiedWarning')}
                  </p>
                )}
                {preview.newDomains.length > 0 && (
                  <p className="flex items-start gap-2.5 rounded-lg border border-ctp-peach/40 bg-ctp-peach/10 px-3 py-2.5 text-ctp-peach">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {t('extensions.install.newDomainsWarning', {
                      from: preview.currentVersion,
                      to: preview.version,
                    })}
                  </p>
                )}
                {preview.nsfw && (
                  <p className="flex items-center gap-2.5 rounded-lg border border-ctp-red/40 bg-ctp-red/10 px-3 py-2.5 text-ctp-red">
                    <Badge variant="danger">18+</Badge>
                    {t('extensions.install.nsfw')}
                  </p>
                )}
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('extensions.install.canAccess')}
                  </h3>
                  <ul className="flex flex-col gap-1.5" aria-label={t('extensions.install.canAccess')}>
                    {preview.domains.map((domain) => (
                      <li
                        key={domain}
                        className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-[13px]"
                      >
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{domain}</span>
                        {preview.newDomains.includes(domain) && (
                          <Badge variant="warning" className="ml-auto font-sans">
                            {t('extensions.install.new')}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Info className="size-3.5" />
                    {t('extensions.install.apiVersion', { version: preview.apiVersion })}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatBytes(preview.size, i18n.language)}</span>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1.5 text-ctp-green" title={preview.sha256}>
                    <CircleCheck className="size-3.5" />
                    {t('extensions.install.shaVerified')}
                  </span>
                </div>
              </>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t px-5 py-4">
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirm} disabled={!preview || Boolean(error) || install.isPending || autoUpdating}>
              {install.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              {isUpdate ? t('extensions.install.update') : t('extensions.install.install')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RepoLine({ preview }: { preview: InstallPreview }) {
  const { t } = useTranslation();
  if (preview.trust === 'official') {
    return (
      <p className="flex items-center gap-1 text-xs text-ctp-green">
        <ShieldCheck className="size-3.5" />
        {t('extensions.install.repoOfficial', { repo: preview.repoName })}
      </p>
    );
  }
  if (preview.trust === 'trusted') {
    return (
      <p className="flex items-center gap-1 text-xs text-ctp-blue">
        <Shield className="size-3.5" />
        {t('extensions.install.repoTrusted', { repo: preview.repoName })}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-ctp-yellow">
      <ShieldAlert className="size-3.5" />
      {t('extensions.install.repoUnverified', { repo: preview.repoName })}
    </p>
  );
}

function InstallError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { title, detail } = useErrorText(error);
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-ctp-red/10 px-3 py-2.5 text-ctp-red">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 select-text">
        <p className="font-medium">{t('extensions.install.failed')}</p>
        <p className="text-xs break-words">
          {title}: {detail}
        </p>
      </div>
    </div>
  );
}
