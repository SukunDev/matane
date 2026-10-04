import {
  DEFAULT_READER_FILTERS,
  type ReaderSettings as ReaderSettingsValue,
  type ReaderTypeDefaults,
} from '@manga-reader/shared';
import {
  READER_BACKGROUNDS,
  READER_DIRECTIONS,
  READER_FITS,
  READER_MODES,
  READER_TYPES,
  RESOLVED_MODES,
  TAP_ZONES,
} from '@manga-reader/shared/reader';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { settingsQuery, useUpdateSettings } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { ZONE_COLUMNS, zoneGrid } from '../reader/navigation';
import { KeymapEditor } from './KeymapEditor';
import { Row, Segmented, Toggle } from './controls';

const ZONE_FILL = { prev: 'bg-ctp-blue/40', next: 'bg-ctp-green/40', menu: 'bg-primary/30' } as const;

/** Settings → Reader (docs/BRAINSTORM.md §6.1, §6.6; mockup 11). Every change saves at once. */
export function ReaderSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const ids = {
    invert: useId(),
    wheel: useId(),
    crop: useId(),
    split: useId(),
    indicator: useId(),
    grayscale: useId(),
    invertColors: useId(),
    color: useId(),
  };
  if (!settings) return null;
  const reader = settings.reader;
  const set = (patch: Partial<ReaderSettingsValue>) => update.mutate({ reader: { ...reader, ...patch } });
  const setFilters = (patch: Partial<ReaderSettingsValue['filters']>) =>
    set({ filters: { ...reader.filters, ...patch } });
  const setType = (type: keyof ReaderTypeDefaults, patch: Partial<ReaderTypeDefaults['manga']>) =>
    set({ typeDefaults: { ...reader.typeDefaults, [type]: { ...reader.typeDefaults[type], ...patch } } });
  const filtersChanged = JSON.stringify(reader.filters) !== JSON.stringify(DEFAULT_READER_FILTERS);

  return (
    <div className="flex flex-col gap-6">
      <p className="-mt-3 text-sm text-muted-foreground">{t('settings.reader.intro')}</p>

      <Section title={t('settings.reader.defaults')} description={t('settings.reader.defaultsHint')}>
        <Row label={t('reader.settings.mode')} stacked>
          <Segmented
            label={t('reader.settings.mode')}
            options={READER_MODES}
            value={reader.mode}
            onChange={(mode) => set({ mode })}
            format={(value) => t(`reader.settings.modes.${value}`)}
          />
        </Row>
        <Row label={t('reader.settings.fit')} stacked>
          <Segmented
            label={t('reader.settings.fit')}
            options={READER_FITS}
            value={reader.fit}
            onChange={(fit) => set({ fit })}
            format={(value) => t(`reader.settings.fits.${value}`)}
          />
        </Row>
        <Row label={t('reader.settings.direction')} stacked>
          <Segmented
            label={t('reader.settings.direction')}
            options={READER_DIRECTIONS}
            value={reader.direction}
            onChange={(direction) => set({ direction })}
            format={(value) => t(`reader.settings.directions.${value}`)}
          />
        </Row>
        <Row label={t('reader.settings.width')} description={t('settings.reader.widthHint')} stacked>
          <Slider
            label={t('reader.settings.width')}
            value={reader.webtoonWidth}
            min={400}
            max={1600}
            step={20}
            unit="px"
            onChange={(webtoonWidth) => set({ webtoonWidth })}
          />
        </Row>
        <Row label={t('reader.settings.gap')} description={t('settings.reader.gapHint')} stacked>
          <Slider
            label={t('reader.settings.gap')}
            value={reader.verticalGap}
            min={0}
            max={64}
            step={4}
            unit="px"
            onChange={(verticalGap) => set({ verticalGap })}
          />
        </Row>
        <Row label={t('reader.settings.background')} stacked>
          <div className="flex items-center gap-3">
            <Segmented
              label={t('reader.settings.background')}
              options={READER_BACKGROUNDS}
              value={reader.background}
              onChange={(background) => set({ background })}
              format={(value) => t(`reader.settings.backgrounds.${value}`)}
            />
            {reader.background === 'custom' && (
              <input
                id={ids.color}
                type="color"
                aria-label={t('settings.reader.backgroundColor')}
                value={reader.backgroundColor}
                onChange={(event) => set({ backgroundColor: event.target.value })}
                className="h-8 w-12 cursor-pointer rounded border bg-transparent"
              />
            )}
          </div>
        </Row>
      </Section>

      <Section title={t('settings.reader.byType')} description={t('settings.reader.byTypeHint')}>
        {READER_TYPES.map((type) => (
          <Row key={type} label={t(`settings.reader.types.${type}`)}>
            <div className="flex items-center gap-3">
              <select
                aria-label={t('settings.reader.typeMode', { type: t(`settings.reader.types.${type}`) })}
                value={reader.typeDefaults[type].mode}
                onChange={(event) => setType(type, { mode: event.target.value as (typeof RESOLVED_MODES)[number] })}
                className="h-9 rounded-lg border border-input bg-background px-2.5"
              >
                {RESOLVED_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`reader.settings.modes.${mode}`)}
                  </option>
                ))}
              </select>
              <Segmented
                label={t('settings.reader.typeDirection', { type: t(`settings.reader.types.${type}`) })}
                options={['ltr', 'rtl'] as const}
                value={reader.typeDefaults[type].direction}
                onChange={(direction) => setType(type, { direction })}
                format={(value) => value.toUpperCase()}
              />
            </div>
          </Row>
        ))}
      </Section>

      <Section title={t('settings.reader.navigation')} description={t('settings.reader.navigationHint')}>
        <Row label={t('reader.settings.tapZones')} stacked>
          <div role="radiogroup" aria-label={t('reader.settings.tapZones')} className="grid grid-cols-5 gap-3">
            {TAP_ZONES.map((zones) => {
              const active = reader.tapZones === zones;
              return (
                <button
                  key={zones}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set({ tapZones: zones })}
                  className="group flex flex-col items-center gap-2"
                >
                  <span
                    className={cn(
                      'grid aspect-[3/4] w-full gap-0.5 overflow-hidden rounded-lg border-2 p-1 transition-colors',
                      active ? 'border-primary' : 'border-transparent bg-ctp-crust/40 group-hover:border-ctp-surface2',
                    )}
                    style={{ gridTemplateColumns: `repeat(${ZONE_COLUMNS}, 1fr)` }}
                  >
                    {zoneGrid(zones, reader.invertTapZones).map((action, i) => (
                      <span
                        key={i}
                        className={cn('rounded-sm', zones === 'off' ? 'bg-ctp-surface0/40' : ZONE_FILL[action])}
                      />
                    ))}
                  </span>
                  <span className={cn('text-xs', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                    {t(`reader.settings.zones.${zones}`)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <Legend className={ZONE_FILL.prev} label={t('reader.tapZones.prev')} />
            <Legend className={ZONE_FILL.next} label={t('reader.tapZones.next')} />
            <Legend className={ZONE_FILL.menu} label={t('reader.tapZones.menu')} />
          </p>
        </Row>
        <Row
          htmlFor={ids.invert}
          label={t('settings.reader.invertZones')}
          description={t('settings.reader.invertZonesHint')}
        >
          <Toggle
            id={ids.invert}
            checked={reader.invertTapZones}
            onChange={(invertTapZones) => set({ invertTapZones })}
          />
        </Row>
        <Row htmlFor={ids.wheel} label={t('settings.reader.wheel')} description={t('settings.reader.wheelHint')}>
          <Toggle
            id={ids.wheel}
            checked={reader.wheelTurnsPages}
            onChange={(wheelTurnsPages) => set({ wheelTurnsPages })}
          />
        </Row>
      </Section>

      <Section title={t('settings.reader.keys')} description={t('settings.reader.keysHint')}>
        <KeymapEditor keymap={reader.keymap} onChange={(keymap) => set({ keymap })} />
      </Section>

      <Section
        title={t('settings.reader.display')}
        description={t('settings.reader.displayHint')}
        action={
          filtersChanged && (
            <Button variant="ghost" size="sm" onClick={() => set({ filters: DEFAULT_READER_FILTERS })}>
              <RotateCcw />
              {t('settings.reader.resetFilters')}
            </Button>
          )
        }
      >
        <Row label={t('settings.reader.brightness')} stacked>
          <Slider
            label={t('settings.reader.brightness')}
            value={reader.filters.brightness}
            min={30}
            max={150}
            step={5}
            unit="%"
            onChange={(brightness) => setFilters({ brightness })}
          />
        </Row>
        <Row label={t('settings.reader.contrast')} stacked>
          <Slider
            label={t('settings.reader.contrast')}
            value={reader.filters.contrast}
            min={50}
            max={150}
            step={5}
            unit="%"
            onChange={(contrast) => setFilters({ contrast })}
          />
        </Row>
        <Row label={t('settings.reader.warm')} description={t('settings.reader.warmHint')} stacked>
          <Slider
            label={t('settings.reader.warm')}
            value={reader.filters.warm}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(warm) => setFilters({ warm })}
          />
        </Row>
        <Row htmlFor={ids.grayscale} label={t('settings.reader.grayscale')}>
          <Toggle
            id={ids.grayscale}
            checked={reader.filters.grayscale}
            onChange={(grayscale) => setFilters({ grayscale })}
          />
        </Row>
        <Row htmlFor={ids.invertColors} label={t('settings.reader.invertColors')}>
          <Toggle id={ids.invertColors} checked={reader.filters.invert} onChange={(invert) => setFilters({ invert })} />
        </Row>
        <Row
          htmlFor={ids.indicator}
          label={t('settings.reader.pageIndicator')}
          description={t('settings.reader.pageIndicatorHint')}
        >
          <Toggle
            id={ids.indicator}
            checked={reader.pageIndicator}
            onChange={(pageIndicator) => set({ pageIndicator })}
          />
        </Row>
        <Row label={t('settings.reader.autoScrollSpeed')} description={t('settings.reader.autoScrollHint')} stacked>
          <Slider
            label={t('settings.reader.autoScrollSpeed')}
            value={reader.autoScrollSpeed}
            min={20}
            max={800}
            step={20}
            unit=" px/s"
            onChange={(autoScrollSpeed) => set({ autoScrollSpeed })}
          />
        </Row>
      </Section>

      <Section title={t('settings.reader.performance')} description={t('settings.reader.performanceHint')}>
        <Row label={t('settings.reader.preload')} description={t('settings.reader.preloadHint')}>
          <div className="inline-flex items-center rounded-lg border">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings.reader.fewer')}
              disabled={reader.preloadPages <= 1}
              onClick={() => set({ preloadPages: reader.preloadPages - 1 })}
            >
              <Minus />
            </Button>
            <output aria-live="polite" className="w-8 text-center font-mono">
              {reader.preloadPages}
            </output>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings.reader.more')}
              disabled={reader.preloadPages >= 10}
              onClick={() => set({ preloadPages: reader.preloadPages + 1 })}
            >
              <Plus />
            </Button>
          </div>
        </Row>
        <Row
          htmlFor={ids.crop}
          label={t('reader.settings.cropBorders')}
          description={t('reader.settings.cropBordersHint')}
        >
          <Toggle id={ids.crop} checked={reader.cropBorders} onChange={(cropBorders) => set({ cropBorders })} />
        </Row>
        <Row
          htmlFor={ids.split}
          label={t('reader.settings.splitTall')}
          description={t('reader.settings.splitTallHint')}
        >
          <Toggle id={ids.split} checked={reader.splitTall} onChange={(splitTall) => set({ splitTall })} />
        </Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 accent-(--app-accent)"
      />
      <span className="w-20 text-right font-mono text-sm text-primary">
        {value}
        {unit}
      </span>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-sm', className)} />
      {label}
    </span>
  );
}
