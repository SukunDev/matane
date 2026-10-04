import {
  DOH_MODES,
  DOH_PROVIDERS,
  type NetworkSettings as NetworkSettingsValue,
  PROXY_MODES,
} from '@manga-reader/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2, RotateCcw, Wifi } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { appError } from '../../lib/errors';
import { ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { Row, Segmented } from './controls';

const networkInfoQuery = { queryKey: ['network', 'info'] as const, queryFn: () => ipc.invoke('network.info') };

/** A DoH server the app accepts: an https:// URL (templates like `{?dns}` allowed). */
export function isDohUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Settings → Network (docs/BRAINSTORM.md §6.5): DNS-over-HTTPS, proxy, User-Agent. Changes apply at once. */
export function NetworkSettings() {
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;
  const network = settings.network;
  const set = (patch: Partial<NetworkSettingsValue>) => update.mutate({ network: { ...network, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <DohSection doh={network.doh} onChange={(doh) => set({ doh })} />
      <ProxySection proxy={network.proxy} onChange={(proxy) => set({ proxy })} />
      <UserAgentSection userAgent={network.userAgent} onChange={(userAgent) => set({ userAgent })} />
      <TestSection />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{description}</p>
      <div className="divide-y">{children}</div>
    </section>
  );
}

/** A text field that saves when it loses focus or on Enter (not on every key). */
function CommitInput({
  id,
  value,
  onCommit,
  invalid = false,
  ...props
}: {
  id?: string;
  value: string;
  onCommit: (value: string) => void;
  invalid?: boolean;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      id={id}
      value={draft ?? value}
      aria-invalid={invalid || undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
      {...props}
    />
  );
}

function DohSection({
  doh,
  onChange,
}: {
  doh: NetworkSettingsValue['doh'];
  onChange: (doh: NetworkSettingsValue['doh']) => void;
}) {
  const { t } = useTranslation();
  const customId = useId();
  const customInvalid = doh.provider === 'custom' && !isDohUrl(doh.customUrl);
  return (
    <Section title={t('settings.network.doh.title')} description={t('settings.network.doh.description')}>
      <Row label={t('settings.network.doh.mode')} description={t(`settings.network.doh.modes.${doh.mode}Hint`)} stacked>
        <Segmented
          label={t('settings.network.doh.mode')}
          options={DOH_MODES}
          value={doh.mode}
          onChange={(mode) => onChange({ ...doh, mode })}
          format={(value) => t(`settings.network.doh.modes.${value}`)}
        />
      </Row>
      {doh.mode !== 'off' && (
        <Row label={t('settings.network.doh.provider')} stacked>
          <div className="flex flex-col gap-3">
            <Segmented
              label={t('settings.network.doh.provider')}
              options={DOH_PROVIDERS}
              value={doh.provider}
              onChange={(provider) => onChange({ ...doh, provider })}
              format={(value) => t(`settings.network.doh.providers.${value}`)}
            />
            {doh.provider === 'custom' && (
              <div className="flex flex-col gap-1">
                <label htmlFor={customId} className="text-xs text-muted-foreground">
                  {t('settings.network.doh.customUrl')}
                </label>
                <CommitInput
                  id={customId}
                  value={doh.customUrl}
                  invalid={customInvalid}
                  placeholder="https://dns.example/dns-query"
                  onCommit={(customUrl) => onChange({ ...doh, customUrl: customUrl.trim() })}
                />
                {customInvalid && <p className="text-xs text-ctp-red">{t('settings.network.doh.invalid')}</p>}
              </div>
            )}
          </div>
        </Row>
      )}
    </Section>
  );
}

function ProxySection({
  proxy,
  onChange,
}: {
  proxy: NetworkSettingsValue['proxy'];
  onChange: (proxy: NetworkSettingsValue['proxy']) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: info } = useQuery(networkInfoQuery);
  const ids = { host: useId(), port: useId(), user: useId(), password: useId() };
  const [password, setPassword] = useState('');
  const savePassword = useMutation({
    mutationFn: (value: string | null) => ipc.invoke('network.setProxyPassword', { password: value }),
    onSuccess: () => {
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: networkInfoQuery.queryKey });
    },
  });
  const manual = proxy.mode === 'http' || proxy.mode === 'socks5';

  return (
    <Section title={t('settings.network.proxy.title')} description={t('settings.network.proxy.description')}>
      <Row label={t('settings.network.proxy.mode')} stacked>
        <Segmented
          label={t('settings.network.proxy.mode')}
          options={PROXY_MODES}
          value={proxy.mode}
          onChange={(mode) => onChange({ ...proxy, mode })}
          format={(value) => t(`settings.network.proxy.modes.${value}`)}
        />
      </Row>
      {manual && (
        <div className="grid grid-cols-[1fr_8rem] gap-3 py-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.host} className="text-xs text-muted-foreground">
              {t('settings.network.proxy.host')}
            </label>
            <CommitInput
              id={ids.host}
              value={proxy.host}
              placeholder="127.0.0.1"
              onCommit={(host) => onChange({ ...proxy, host: host.trim() })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.port} className="text-xs text-muted-foreground">
              {t('settings.network.proxy.port')}
            </label>
            <CommitInput
              id={ids.port}
              value={proxy.port === null ? '' : String(proxy.port)}
              inputMode="numeric"
              placeholder={proxy.mode === 'http' ? '8080' : '1080'}
              onCommit={(port) => {
                const value = Number(port);
                onChange({ ...proxy, port: Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : null });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.user} className="text-xs text-muted-foreground">
              {t('settings.network.proxy.username')}
            </label>
            <CommitInput
              id={ids.user}
              value={proxy.username}
              autoComplete="off"
              onCommit={(username) => onChange({ ...proxy, username: username.trim() })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <label htmlFor={ids.password} className="text-xs text-muted-foreground">
              {t('settings.network.proxy.password')}
            </label>
            <div className="flex gap-2">
              <Input
                id={ids.password}
                type="password"
                autoComplete="off"
                value={password}
                placeholder={info?.hasProxyPassword ? t('settings.network.proxy.passwordSaved') : ''}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={!password || savePassword.isPending}
                onClick={() => savePassword.mutate(password)}
              >
                {t('settings.network.proxy.savePassword')}
              </Button>
              {info?.hasProxyPassword && (
                <Button variant="ghost" onClick={() => savePassword.mutate(null)}>
                  {t('settings.network.proxy.forgetPassword')}
                </Button>
              )}
            </div>
            {savePassword.isError && <p className="text-xs text-ctp-red">{appError(savePassword.error).message}</p>}
            <p className="text-xs text-muted-foreground">{t('settings.network.proxy.passwordHint')}</p>
            {info && !info.passwordEncrypted && (
              <p className="text-xs text-ctp-peach">{t('settings.network.proxy.noKeyring')}</p>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function UserAgentSection({
  userAgent,
  onChange,
}: {
  userAgent: string | null;
  onChange: (userAgent: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data: info } = useQuery(networkInfoQuery);
  const id = useId();
  return (
    <Section title={t('settings.network.userAgent.title')} description={t('settings.network.userAgent.description')}>
      <div className="flex flex-col gap-2 py-1">
        <label htmlFor={id} className="sr-only">
          {t('settings.network.userAgent.title')}
        </label>
        <div className="flex gap-2">
          <CommitInput
            id={id}
            value={userAgent ?? ''}
            placeholder={info?.defaultUserAgent}
            className="font-mono text-xs"
            onCommit={(value) => onChange(value.trim() || null)}
          />
          <Button variant="ghost" disabled={userAgent === null} onClick={() => onChange(null)}>
            <RotateCcw />
            {t('settings.network.userAgent.reset')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {userAgent === null
            ? t('settings.network.userAgent.usingDefault')
            : t('settings.network.userAgent.usingCustom')}
        </p>
      </div>
    </Section>
  );
}

function TestSection() {
  const { t } = useTranslation();
  const test = useMutation({ mutationFn: () => ipc.invoke('network.test') });
  const result = test.data;
  return (
    <Section title={t('settings.network.test.title')} description={t('settings.network.test.description')}>
      <div className="flex items-center gap-4 py-1">
        <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <Wifi />}
          {t('settings.network.test.run')}
        </Button>
        {result && (
          <p role="status" data-testid="network-test" className="flex items-center gap-2 text-sm">
            {result.ok ? (
              <CircleCheck className="size-4 text-ctp-green" />
            ) : (
              <CircleX className="size-4 text-ctp-red" />
            )}
            {result.ok
              ? t('settings.network.test.ok', { ms: result.ms, status: result.status })
              : result.status !== null
                ? t('settings.network.test.http', { status: result.status })
                : t('settings.network.test.failed', { error: result.error })}
          </p>
        )}
      </div>
      {result && <p className="pt-1 font-mono text-xs text-muted-foreground">{result.url}</p>}
    </Section>
  );
}
