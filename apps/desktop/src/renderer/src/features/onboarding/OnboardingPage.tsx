import { DOWNLOAD_FORMATS } from '@manga-reader/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, FolderOpen, Search } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowControls } from '../../components/shell/WindowControls';
import { Button } from '../../components/ui/button';
import { useContentFilter } from '../../lib/content';
import { downloadFolderQuery } from '../../lib/downloads';
import { availableExtensionsQuery } from '../../lib/extensions';
import { languageName } from '../../lib/format';
import { appInfoQuery, ipc, settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { extensionsQuery, sourcesQuery } from '../../lib/sources';
import { cn } from '../../lib/utils';
import { COMMON_LANGUAGES, NsfwToggle } from '../extensions/ContentControls';
import { ZONE_COLUMNS, zoneGrid } from '../reader/navigation';
import { AccentPicker, LanguagePicker, ThemePicker } from '../settings/appearance';
import { Segmented } from '../settings/controls';

const STEPS = ['appearance', 'languages', 'downloads', 'sources', 'reader'] as const;

/**
 * First-run setup (docs/BRAINSTORM.md §6.6, mockup 13): appearance, content languages, download folder,
 * sources, and the reader controls. Every step saves as it goes; "Skip setup" keeps the defaults.
 * Run again from Settings → About.
 */
export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: info } = useQuery(appInfoQuery);
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const isMac = info?.platform === 'darwin';

  const finish = () => {
    update.mutate({ onboarding: { done: true } }, { onSuccess: () => void navigate({ to: '/library' }) });
  };

  return (
    <div className="flex h-full flex-col bg-ctp-crust" data-testid="onboarding">
      <header className="drag-region flex h-10 shrink-0 items-center gap-2 border-b bg-sidebar px-3">
        <div className={isMac ? 'w-16' : 'w-0'} />
        <span className="text-[13px] font-semibold">{t('app.name')}</span>
        <span className="text-[13px] text-muted-foreground">· {t('onboarding.windowTitle')}</span>
        <div className="ml-auto flex h-full items-center">{!isMac && <WindowControls />}</div>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <div className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border bg-background shadow-2xl">
          <div className="border-b px-8 pt-6 pb-5">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wider text-primary uppercase">{t('onboarding.label')}</p>
              <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {t('onboarding.stepOf', { step: index + 1, total: STEPS.length })}
              </span>
            </div>
            <ol className="grid grid-cols-5 gap-2">
              {STEPS.map((name, i) => (
                <li key={name} className="flex flex-col items-center gap-1.5 text-center">
                  <span
                    aria-current={i === index ? 'step' : undefined}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
                      i < index && 'border-ctp-green/50 bg-ctp-green/15 text-ctp-green',
                      i === index && 'border-primary bg-primary text-primary-foreground',
                      i > index && 'text-muted-foreground',
                    )}
                  >
                    {i < index ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn('text-xs', i === index ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                    {t(`onboarding.steps.${name}`)}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {step === 'appearance' && <AppearanceStep />}
            {step === 'languages' && <LanguagesStep />}
            {step === 'downloads' && settings && <DownloadsStep />}
            {step === 'sources' && <SourcesStep />}
            {step === 'reader' && <ReaderStep />}
          </div>

          <footer className="flex items-center gap-3 border-t px-8 py-4">
            <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              {t('onboarding.back')}
            </Button>
            <span className="flex-1" />
            {!last && (
              <Button variant="ghost" onClick={finish}>
                {t('onboarding.skip')}
              </Button>
            )}
            <Button onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? t('onboarding.finish') : t('onboarding.continue')}
              <ArrowRight />
            </Button>
          </footer>
        </div>
      </main>
    </div>
  );
}

function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 py-3">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

function AppearanceStep() {
  const { t } = useTranslation();
  return (
    <>
      <StepTitle title={t('onboarding.appearance.title')} description={t('onboarding.appearance.description')} />
      <Field label={t('settings.language.label')}>
        <LanguagePicker />
      </Field>
      <Field label={t('settings.theme.label')}>
        <ThemePicker />
      </Field>
      <Field label={t('settings.accent.label')}>
        <AccentPicker />
      </Field>
    </>
  );
}

function LanguagesStep() {
  const { t, i18n } = useTranslation();
  const { browse, languages } = useContentFilter();
  const update = useUpdateSettings();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const { data: available = [] } = useQuery(availableExtensionsQuery);
  const [search, setSearch] = useState('');
  const nsfwId = useId();
  const known = new Set([
    ...COMMON_LANGUAGES,
    ...languages,
    ...sources.map((s) => s.lang),
    ...available.flatMap((a) => a.langs),
  ]);
  for (const any of ['all', 'multi', 'other']) known.delete(any);
  const options = [...known]
    .map((code) => ({ code, native: languageName(code, code), name: languageName(code, i18n.language) }))
    .filter(({ native, name, code }) => `${native} ${name} ${code}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort(
      (a, b) => Number(languages.includes(b.code)) - Number(languages.includes(a.code)) || a.name.localeCompare(b.name),
    );
  const toggle = (code: string) => {
    const on = languages.includes(code);
    if (on && languages.length === 1) return; // at least one language stays on
    update.mutate({
      browse: { ...browse, languages: on ? languages.filter((l) => l !== code) : [...languages, code] },
    });
  };
  const shownSources = sources.filter(
    (s) => s.installed && (s.lang === 'all' || s.lang === 'multi' || languages.includes(s.lang)),
  );

  return (
    <>
      <StepTitle title={t('onboarding.languages.title')} description={t('onboarding.languages.description')} />
      <label className="mb-4 flex h-10 items-center gap-2 rounded-lg border bg-muted/30 px-3">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('onboarding.languages.search')}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <div role="group" aria-label={t('settings.browse.languages.label')} className="grid grid-cols-3 gap-2.5">
        {options.map(({ code, native, name }) => {
          const on = languages.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(code)}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-input',
                on && 'border-primary bg-primary/10',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{native}</span>
                <span className="block truncate text-xs text-muted-foreground">{name}</span>
              </span>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {on && <Check className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 border-t pt-4">
        <p className="text-sm">
          <span className="font-medium text-primary">
            {t('onboarding.languages.selected', { count: languages.length })}
          </span>
          <span className="text-muted-foreground">
            {' '}
            · {t('onboarding.languages.sources', { count: shownSources.length })}
          </span>
        </p>
        <label htmlFor={nsfwId} className="flex items-center gap-3 text-right text-sm">
          <span>
            <span className="block">{t('settings.browse.nsfw.label')}</span>
            <span className="text-xs text-muted-foreground">{t('onboarding.languages.nsfwHint')}</span>
          </span>
          <NsfwToggle id={nsfwId} />
        </label>
      </div>
    </>
  );
}

function DownloadsStep() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const downloads = settings!.downloads;
  const { data: folder } = useQuery(downloadFolderQuery(downloads.folder));
  const pick = useMutation({
    mutationFn: async () => {
      const target = await ipc.invoke('downloads.pickFolder');
      if (target) await ipc.invoke('downloads.setFolder', { folder: target, move: false });
    },
  });
  return (
    <>
      <StepTitle title={t('onboarding.downloads.title')} description={t('onboarding.downloads.description')} />
      <Field label={t('settings.downloads.folder')}>
        <div className="flex items-center gap-3">
          <code
            data-testid="onboarding-folder"
            className="min-w-0 flex-1 truncate rounded-lg border bg-muted/30 px-3 py-2 text-sm"
          >
            {folder}
          </code>
          <Button variant="secondary" onClick={() => pick.mutate()} disabled={pick.isPending}>
            <FolderOpen />
            {t('onboarding.downloads.choose')}
          </Button>
        </div>
      </Field>
      <Field label={t('settings.downloads.format')}>
        <Segmented
          label={t('settings.downloads.format')}
          options={DOWNLOAD_FORMATS}
          value={downloads.format}
          onChange={(format) => update.mutate({ downloads: { ...downloads, format } })}
          format={(value) => t(`settings.downloads.formats.${value}`)}
        />
      </Field>
      <p className="mt-2 text-xs text-muted-foreground">{t('onboarding.downloads.later')}</p>
    </>
  );
}

function SourcesStep() {
  const { t } = useTranslation();
  const { visible } = useContentFilter();
  const { data: installed = [] } = useQuery(extensionsQuery);
  const ready = installed.filter((extension) => extension.error === null && visible(extension));

  return (
    <>
      <StepTitle title={t('onboarding.sources.title')} description={t('onboarding.sources.description')} />
      <Field label={t('onboarding.sources.ready')}>
        {ready.length > 0 ? (
          <ul data-testid="onboarding-ready" className="flex flex-wrap gap-2">
            {ready.map((extension) => (
              <li key={extension.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
                <Check className="size-3.5 text-ctp-green" />
                {extension.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('onboarding.sources.none')}</p>
        )}
      </Field>
      <p className="mt-2 text-xs text-muted-foreground">{t('onboarding.sources.later')}</p>
    </>
  );
}

function ReaderStep() {
  const { t } = useTranslation();
  const keys: [string, string][] = [
    ['→ / D / Space', t('onboarding.reader.next')],
    ['← / A', t('onboarding.reader.prev')],
    ['[ / ]', t('onboarding.reader.chapters')],
    ['F', t('onboarding.reader.fullscreen')],
    ['M', t('onboarding.reader.menu')],
    ['Ctrl + scroll', t('onboarding.reader.zoom')],
    ['Ctrl + K', t('onboarding.reader.palette')],
  ];
  const zones = zoneGrid('l', false);
  return (
    <>
      <StepTitle title={t('onboarding.reader.title')} description={t('onboarding.reader.description')} />
      <div className="grid grid-cols-[10rem_1fr] gap-8">
        <figure className="flex flex-col items-center gap-2">
          <div
            className="grid aspect-[3/4] w-full gap-0.5 rounded-lg border p-1"
            style={{ gridTemplateColumns: `repeat(${ZONE_COLUMNS}, 1fr)` }}
          >
            {zones.map((action, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-sm',
                  action === 'prev' ? 'bg-ctp-blue/40' : action === 'next' ? 'bg-ctp-green/40' : 'bg-primary/30',
                )}
              />
            ))}
          </div>
          <figcaption className="text-center text-xs text-muted-foreground">{t('onboarding.reader.zones')}</figcaption>
        </figure>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-2.5 text-sm">
          {keys.map(([key, what]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{key}</kbd>
              </dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">{t('onboarding.reader.later')}</p>
    </>
  );
}
