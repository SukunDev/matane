import type { ExtensionEntry, SourceEntry } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Globe, Link2, Loader2, Pin, PinOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useContentFilter } from '../../lib/content';
import { useErrorText } from '../../lib/errors';
import { formatRelative, languageName } from '../../lib/format';
import { ipc } from '../../lib/ipc';
import { extensionsQuery, sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { SourceIcon } from './SourceIcon';
import { extensionIconUrl } from '../../lib/extensions';

/** UI language first, then English, then the rest alphabetically. */
function groupByLanguage(sources: SourceEntry[], uiLanguage: string): [string, SourceEntry[]][] {
  const groups = new Map<string, SourceEntry[]>();
  for (const source of sources) groups.set(source.lang, [...(groups.get(source.lang) ?? []), source]);
  const rank = (lang: string) => (lang === uiLanguage ? 0 : lang === 'en' ? 1 : 2);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

export function SourcesPage() {
  const { t, i18n } = useTranslation();
  const { data: sources = [], isPending } = useQuery(sourcesQuery);
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const extensionById = new Map(extensions.map((e) => [e.id, e]));
  const content = useContentFilter();
  const allInstalled = sources.filter((s) => s.installed);
  // Content settings (§6.6): other languages and adult sources are hidden.
  const installed = allInstalled.filter((s) => content.visible({ langs: [s.lang], nsfw: s.nsfw }));
  const hidden = allInstalled.length - installed.length;
  const pinned = installed.filter((s) => s.pinned);
  const groups = groupByLanguage(
    installed.filter((s) => !s.pinned),
    i18n.language,
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{t('nav.sources')}</h1>
          <p className="text-xs text-muted-foreground">{t('browse.sources.subtitle', { count: installed.length })}</p>
        </div>
        <OpenFromUrl />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hidden > 0 && (
          <p className="mx-auto max-w-5xl px-6 pt-4 text-xs text-muted-foreground" data-testid="hidden-by-content">
            {t('browse.sources.hiddenByContent', { count: hidden })}{' '}
            <Link to="/settings/$section" params={{ section: 'browse' }} className="text-primary hover:underline">
              {t('extensions.changeContent')}
            </Link>
          </p>
        )}
        {!isPending && installed.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={t('empty.sources.title')}
            description={t('empty.sources.description')}
            action={
              <Button asChild variant="secondary">
                <Link to="/browse/extensions" search={{ tab: 'available' }}>
                  {t('extensions.getExtensions')}
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
            {pinned.length > 0 && (
              <SourceGroup title={t('browse.sources.pinned')} sources={pinned} extensions={extensionById} />
            )}
            {groups.map(([lang, list]) => (
              <SourceGroup
                key={lang}
                title={languageName(lang, i18n.language)}
                sources={list}
                extensions={extensionById}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceGroup({
  title,
  sources,
  extensions,
}: {
  title: string;
  sources: SourceEntry[];
  extensions: Map<string, ExtensionEntry>;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        <span className="rounded bg-muted px-1.5 font-normal">{sources.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} extension={extensions.get(source.extensionId)} />
        ))}
      </ul>
    </section>
  );
}

function SourceRow({ source, extension }: { source: SourceEntry; extension?: ExtensionEntry }) {
  const { t, i18n } = useTranslation();
  const togglePin = useMutation({
    mutationFn: () => ipc.invoke('sources.setPinned', { sourceId: source.id, pinned: !source.pinned }),
  });
  const params = { extensionId: source.extensionId, sourceKey: source.key };

  return (
    <li className="group flex items-center gap-3 rounded-xl border bg-card/40 p-3 transition-colors hover:border-input hover:bg-card/70">
      <Link
        to="/browse/sources/$extensionId/$sourceKey"
        params={params}
        search={{ tab: 'popular' }}
        className="flex min-w-0 flex-1 items-center gap-3 outline-offset-4"
      >
        <SourceIcon
          id={source.extensionId}
          name={source.name}
          src={source.installed && source.hasIcon ? extensionIconUrl(source.extensionId) : null}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{source.name}</span>
            <Badge>{source.lang.toUpperCase()}</Badge>
            {extension?.nsfw && <Badge variant="danger">18+</Badge>}
            {extension?.origin === 'dev' && <Badge variant="info">{t('extensions.dev')}</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {extension ? `${extension.name} ${extension.version}` : source.extensionId}
            {source.lastUsedAt !== null &&
              ` · ${t('browse.sources.lastUsed', { when: formatRelative(source.lastUsedAt, i18n.language) })}`}
          </p>
        </div>
      </Link>
      <Button asChild variant="ghost" size="sm">
        <Link to="/browse/sources/$extensionId/$sourceKey" params={params} search={{ tab: 'latest' }}>
          {t('browse.tabs.latest')}
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={source.pinned ? t('browse.sources.unpin') : t('browse.sources.pin')}
        aria-pressed={source.pinned}
        onClick={() => togglePin.mutate()}
        className={cn(source.pinned && 'text-primary')}
      >
        {source.pinned ? <PinOff /> : <Pin />}
      </Button>
    </li>
  );
}

/** Paste a manga's web link; the source that recognises it opens the manga. */
function OpenFromUrl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const resolve = useMutation({
    mutationFn: (value: string) => ipc.invoke('sources.resolveUrl', { url: value }),
    onSuccess: (result) => {
      if (result) void navigate({ to: '/manga/$mangaId', params: { mangaId: String(result.mangaId) } });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (value) resolve.mutate(value);
  };
  const invalid = url.trim() !== '' && !/^https?:\/\/\S+$/.test(url.trim());

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-1">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              resolve.reset();
            }}
            placeholder={t('browse.openUrl.placeholder')}
            aria-label={t('browse.openUrl.label')}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={invalid || !url.trim() || resolve.isPending}>
          {resolve.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          {t('browse.openUrl.open')}
        </Button>
      </div>
      {resolve.isSuccess && resolve.data === null && (
        <p className="text-xs text-ctp-peach">{t('browse.openUrl.noMatch')}</p>
      )}
      {resolve.isError && <ResolveError error={resolve.error} />}
    </form>
  );
}

function ResolveError({ error }: { error: unknown }) {
  const { title } = useErrorText(error);
  return <p className="text-xs text-ctp-red">{title}</p>;
}
