import type { BrowseItem, SourceEntry } from '@manga-reader/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverImage } from '../../components/CoverImage';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { sourceSearchQuery } from '../../lib/search';
import { MangaCardSkeleton } from '../browse/MangaGrid';

/** "Search manually": any query in one of the target sources; clicking a result picks it. */
export function ManualSearchDialog({
  open,
  onOpenChange,
  initialQuery,
  targets,
  excludeMangaId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
  targets: SourceEntry[];
  excludeMangaId: number;
  onPick: (sourceId: string, item: BrowseItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(40rem,85vh)] w-[min(52rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t('migration.manualTitle')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('migration.manualDescription')}</Dialog.Description>
          {targets.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">{t('migration.noTargets')}</p>
          ) : (
            <ManualSearch
              initialQuery={initialQuery}
              targets={targets}
              excludeMangaId={excludeMangaId}
              onPick={onPick}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ManualSearch({
  initialQuery,
  targets,
  excludeMangaId,
  onPick,
}: {
  initialQuery: string;
  targets: SourceEntry[];
  excludeMangaId: number;
  onPick: (sourceId: string, item: BrowseItem) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [sourceId, setSourceId] = useState(targets[0]?.id ?? '');
  const results = useQuery({ ...sourceSearchQuery(sourceId, query), enabled: sourceId !== '' && query !== '' });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };
  return (
    <>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t('migration.manualQuery')}
          className="h-9"
        />
        <select
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          aria-label={t('migration.manualSource')}
          className="h-9 max-w-56 rounded-lg border border-input bg-background px-2 text-sm"
        >
          {targets.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name} ({source.lang.toUpperCase()})
            </option>
          ))}
        </select>
        <Button type="submit" className="h-9">
          <Search />
          {t('migration.manualSearch')}
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.isError ? (
          <ErrorState compact error={results.error} sourceId={sourceId} onRetry={() => void results.refetch()} />
        ) : results.data?.items.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">{t('globalSearch.noResults')}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
            {results.data
              ? results.data.items
                  .filter((item) => item.mangaId !== excludeMangaId)
                  .map((item) => (
                    <button
                      key={item.mangaId}
                      type="button"
                      onClick={() => onPick(sourceId, item)}
                      className="group flex min-w-0 flex-col gap-1.5 text-left"
                      title={item.title}
                    >
                      <CoverImage
                        mangaId={item.mangaId}
                        coverKey={item.coverKey}
                        alt={item.title}
                        className="aspect-[2/3] rounded-lg border transition-colors group-hover:border-primary"
                      />
                      <span className="line-clamp-2 text-xs font-medium group-hover:text-primary">{item.title}</span>
                    </button>
                  ))
              : Array.from({ length: 6 }, (_, i) => <MangaCardSkeleton key={i} />)}
          </div>
        )}
      </div>
    </>
  );
}
