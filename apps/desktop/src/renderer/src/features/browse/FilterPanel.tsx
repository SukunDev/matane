import type { Filter, FilterState } from '@manga-reader/shared';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

type FilterValue = FilterState[string];
type Leaf = Exclude<Filter, { type: 'group' | 'header' | 'separator' }>;

function defaultOf(filter: Leaf): FilterValue | undefined {
  if (filter.type === 'checkbox') return filter.default ?? false;
  if (filter.type === 'select' || filter.type === 'sort') return filter.default;
  return undefined;
}

function leaves(filters: readonly Filter[]): Leaf[] {
  return filters.flatMap((f) =>
    f.type === 'group' ? leaves(f.filters) : f.type === 'header' || f.type === 'separator' ? [] : [f],
  );
}

/** Filters the user changed from their defaults (what the badge counts). */
export function countActiveFilters(state: FilterState): number {
  return Object.keys(state).length;
}

/** Stores only values that differ from the default, so "no filters" is `{}`. */
function withValue(state: FilterState, filter: Leaf, value: FilterValue | undefined): FilterState {
  const next = { ...state };
  const fallback = defaultOf(filter);
  if (value === undefined || value === '' || JSON.stringify(value) === JSON.stringify(fallback)) delete next[filter.id];
  else next[filter.id] = value;
  return next;
}

export function FilterPanel({
  filters,
  value,
  onApply,
  onClose,
}: {
  filters: readonly Filter[];
  value: FilterState;
  onApply: (state: FilterState) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FilterState>(value);
  const byId = new Map(leaves(filters).map((f) => [f.id, f]));
  const set = (id: string, next: FilterValue | undefined) => {
    const filter = byId.get(id);
    if (filter) setDraft((current) => withValue(current, filter, next));
  };
  const read = (filter: Leaf) => draft[filter.id] ?? defaultOf(filter);
  const active = countActiveFilters(draft);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-sidebar">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="text-base font-semibold">{t('browse.filters.title')}</h2>
        {active > 0 && (
          <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            {t('browse.filters.active', { count: active })}
          </span>
        )}
        <Button variant="ghost" size="icon" className="ml-auto" title={t('common.close')} onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <FilterList filters={filters} read={read} set={set} />
      </div>

      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t p-4">
        <Button variant="secondary" onClick={() => setDraft({})}>
          {t('browse.filters.reset')}
        </Button>
        <Button onClick={() => onApply(draft)}>{t('browse.filters.apply')}</Button>
      </footer>
    </aside>
  );
}

interface ControlProps {
  read: (filter: Leaf) => FilterValue | undefined;
  set: (id: string, value: FilterValue | undefined) => void;
}

function FilterList({ filters, read, set }: ControlProps & { filters: readonly Filter[] }) {
  return (
    <div className="flex flex-col">
      {filters.map((filter, index) => (
        <FilterNode
          key={'id' in filter ? filter.id : `${filter.type}-${index}`}
          filter={filter}
          read={read}
          set={set}
        />
      ))}
    </div>
  );
}

const sectionTitle = 'mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase';

function FilterNode({ filter, read, set }: ControlProps & { filter: Filter }) {
  const { t } = useTranslation();
  switch (filter.type) {
    case 'header':
      return <h3 className={cn(sectionTitle, 'mt-4')}>{filter.label}</h3>;
    case 'separator':
      return <hr className="my-3" />;
    case 'group': {
      const allTristate = filter.filters.length > 0 && filter.filters.every((f) => f.type === 'tristate');
      const allCheckbox = filter.filters.length > 0 && filter.filters.every((f) => f.type === 'checkbox');
      return (
        <section className="border-b py-4 last:border-b-0">
          <div className="flex items-baseline justify-between">
            <h3 className={sectionTitle}>{filter.label}</h3>
            {allTristate && (
              <span className="text-[11px] text-muted-foreground">{t('browse.filters.tristateHint')}</span>
            )}
          </div>
          {allTristate ? (
            <div className="flex flex-wrap gap-1.5">
              {filter.filters.map(
                (f) => f.type === 'tristate' && <TriStateChip key={f.id} filter={f} read={read} set={set} />,
              )}
            </div>
          ) : allCheckbox ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {filter.filters.map(
                (f) => f.type === 'checkbox' && <CheckboxRow key={f.id} filter={f} read={read} set={set} />,
              )}
            </div>
          ) : (
            <FilterList filters={filter.filters} read={read} set={set} />
          )}
        </section>
      );
    }
    case 'checkbox':
      return <CheckboxRow filter={filter} read={read} set={set} />;
    case 'tristate':
      return (
        <div className="py-1">
          <TriStateChip filter={filter} read={read} set={set} />
        </div>
      );
    case 'text':
      return (
        <label className="flex flex-col gap-2 py-3">
          <span className={sectionTitle}>{filter.label}</span>
          <Input
            value={(read(filter) as string | undefined) ?? ''}
            placeholder={filter.placeholder}
            onChange={(event) => set(filter.id, event.target.value)}
          />
        </label>
      );
    case 'select':
      return (
        <label className="flex flex-col gap-2 py-3">
          <span className={sectionTitle}>{filter.label}</span>
          <NativeSelect
            value={(read(filter) as string | undefined) ?? ''}
            onChange={(value) => set(filter.id, value)}
            options={filter.options}
          />
        </label>
      );
    case 'sort': {
      const current = read(filter) as { value: string; ascending: boolean } | undefined;
      const value = current ?? { value: filter.options[0]?.value ?? '', ascending: false };
      return (
        <div className="flex flex-col gap-2 border-b py-4">
          <span className={sectionTitle}>{filter.label}</span>
          <div className="flex gap-2">
            <NativeSelect
              value={value.value}
              onChange={(next) => set(filter.id, { ...value, value: next })}
              options={filter.options}
            />
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              title={value.ascending ? t('browse.filters.ascending') : t('browse.filters.descending')}
              onClick={() => set(filter.id, { ...value, ascending: !value.ascending })}
            >
              {value.ascending ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            </Button>
          </div>
        </div>
      );
    }
  }
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:border-primary focus-visible:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxRow({ filter, read, set }: ControlProps & { filter: Extract<Filter, { type: 'checkbox' }> }) {
  const checked = read(filter) === true;
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => set(filter.id, event.target.checked)}
        className="size-4 accent-(--app-accent)"
      />
      <span className="truncate">{filter.label}</span>
    </label>
  );
}

/** Click cycles: off → include → exclude → off (Mihon behaviour). */
function TriStateChip({ filter, read, set }: ControlProps & { filter: Extract<Filter, { type: 'tristate' }> }) {
  const { t } = useTranslation();
  const state = read(filter);
  const next = state === 'include' ? 'exclude' : state === 'exclude' ? undefined : 'include';
  const label =
    state === 'include'
      ? t('browse.filters.included', { name: filter.label })
      : state === 'exclude'
        ? t('browse.filters.excluded', { name: filter.label })
        : filter.label;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => set(filter.id, next)}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border border-input px-3 text-xs transition-colors hover:border-foreground/40',
        state === 'include' && 'border-ctp-green/50 bg-ctp-green/10 text-ctp-green',
        state === 'exclude' && 'border-ctp-red/50 bg-ctp-red/10 text-ctp-red',
      )}
    >
      {state === 'include' && <Check className="size-3" />}
      {state === 'exclude' && <Minus className="size-3" />}
      {filter.label}
    </button>
  );
}
