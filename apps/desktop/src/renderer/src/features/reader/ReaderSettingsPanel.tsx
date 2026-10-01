import type { ReaderSettings } from '@manga-reader/shared';
import {
  READER_BACKGROUNDS,
  READER_DIRECTIONS,
  READER_FITS,
  READER_MODES,
  TAP_ZONES,
} from '@manga-reader/shared/reader';
import { BookMarked, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { ResolvedMode } from './navigation';

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  render: (value: T) => ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[11px] font-semibold tracking-wider text-ctp-subtext0 uppercase">{label}</legend>
      <div role="radiogroup" className="flex flex-wrap gap-1 rounded-lg border border-ctp-surface1 bg-ctp-crust/60 p-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 flex-1 rounded-md px-2 text-xs whitespace-nowrap text-ctp-subtext1 transition-colors hover:text-ctp-text',
              value === option && 'bg-primary font-semibold text-primary-foreground hover:text-primary-foreground',
            )}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-ctp-surface1 bg-ctp-crust/60 p-3">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="text-xs text-ctp-subtext0">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-(--app-accent)"
      />
    </label>
  );
}

function Range({
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
    <label className="flex flex-col gap-2 rounded-lg border border-ctp-surface1 bg-ctp-crust/60 p-3">
      <span className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-ctp-subtext0">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-(--app-accent)"
      />
    </label>
  );
}

/** Quick settings drawer (docs/ui/screens/03-reader-single.png). Changes save globally at once. */
export function ReaderSettingsPanel({
  settings,
  mode,
  mangaOverride,
  onChange,
  onSaveForManga,
  onResetManga,
  onClose,
}: {
  settings: ReaderSettings;
  /** The mode in effect ("auto" resolved), to show only relevant options. */
  mode: ResolvedMode;
  /** This manga has its own settings (changes then apply to it only). */
  mangaOverride: boolean;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onSaveForManga: () => void;
  onResetManga: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const paged = mode === 'single' || mode === 'double';

  return (
    <aside
      onClick={(event) => event.stopPropagation()}
      className="absolute top-16 right-4 bottom-20 z-30 flex w-80 flex-col rounded-2xl border border-ctp-surface1 bg-ctp-mantle/95 text-ctp-text shadow-2xl backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-ctp-surface1 px-4 py-3">
        <SlidersHorizontal className="size-4 text-primary" />
        <h2 className="text-xs font-semibold tracking-wider uppercase">{t('reader.settings.title')}</h2>
        <Button variant="ghost" size="icon" className="ml-auto" title={t('common.close')} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="flex flex-col gap-5 overflow-y-auto p-4">
        <Segmented
          label={t('reader.settings.mode')}
          value={settings.mode}
          options={READER_MODES}
          onChange={(value) => onChange({ mode: value })}
          render={(value) => t(`reader.settings.modes.${value}`)}
        />
        {paged && (
          <>
            <Segmented
              label={t('reader.settings.direction')}
              value={settings.direction}
              options={READER_DIRECTIONS}
              onChange={(value) => onChange({ direction: value })}
              render={(value) => t(`reader.settings.directions.${value}`)}
            />
            <Segmented
              label={t('reader.settings.fit')}
              value={settings.fit}
              options={READER_FITS}
              onChange={(value) => onChange({ fit: value })}
              render={(value) => t(`reader.settings.fits.${value}`)}
            />
          </>
        )}
        {mode === 'double' && (
          <Toggle
            label={t('reader.settings.shift')}
            hint={t('reader.settings.shiftHint')}
            checked={settings.shiftDouble}
            onChange={(value) => onChange({ shiftDouble: value })}
          />
        )}
        <Toggle
          label={t('reader.settings.cropBorders')}
          hint={t('reader.settings.cropBordersHint')}
          checked={settings.cropBorders}
          onChange={(value) => onChange({ cropBorders: value })}
        />
        {!paged && (
          <Toggle
            label={t('reader.settings.splitTall')}
            hint={t('reader.settings.splitTallHint')}
            checked={settings.splitTall}
            onChange={(value) => onChange({ splitTall: value })}
          />
        )}
        {!paged && (
          <Range
            label={t('reader.settings.width')}
            value={settings.webtoonWidth}
            min={400}
            max={1600}
            step={20}
            unit="px"
            onChange={(value) => onChange({ webtoonWidth: value })}
          />
        )}
        {mode === 'vertical' && (
          <Range
            label={t('reader.settings.gap')}
            value={settings.verticalGap}
            min={0}
            max={64}
            step={4}
            unit="px"
            onChange={(value) => onChange({ verticalGap: value })}
          />
        )}
        <Segmented
          label={t('reader.settings.tapZones')}
          value={settings.tapZones}
          options={TAP_ZONES}
          onChange={(value) => onChange({ tapZones: value })}
          render={(value) => t(`reader.settings.zones.${value}`)}
        />
        <Segmented
          label={t('reader.settings.background')}
          value={settings.background}
          options={READER_BACKGROUNDS}
          onChange={(value) => onChange({ background: value })}
          render={(value) => t(`reader.settings.backgrounds.${value}`)}
        />
        {settings.background === 'custom' && (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-ctp-surface1 bg-ctp-crust/60 p-3 text-sm">
            {t('settings.reader.backgroundColor')}
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(event) => onChange({ backgroundColor: event.target.value })}
              className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-semibold tracking-wider text-ctp-subtext0 uppercase">
            {t('settings.reader.display')}
          </legend>
          <Range
            label={t('settings.reader.brightness')}
            value={settings.filters.brightness}
            min={30}
            max={150}
            step={5}
            unit="%"
            onChange={(value) => onChange({ filters: { ...settings.filters, brightness: value } })}
          />
          <Range
            label={t('settings.reader.warm')}
            value={settings.filters.warm}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(value) => onChange({ filters: { ...settings.filters, warm: value } })}
          />
          <Toggle
            label={t('settings.reader.grayscale')}
            hint={t('settings.reader.grayscaleHint')}
            checked={settings.filters.grayscale}
            onChange={(value) => onChange({ filters: { ...settings.filters, grayscale: value } })}
          />
          <Toggle
            label={t('settings.reader.invertColors')}
            hint={t('settings.reader.invertColorsHint')}
            checked={settings.filters.invert}
            onChange={(value) => onChange({ filters: { ...settings.filters, invert: value } })}
          />
        </fieldset>
        <Link
          to="/settings/$section"
          params={{ section: 'reader' }}
          className="self-start text-xs font-medium text-primary hover:underline"
        >
          {t('reader.settings.allSettings')}
        </Link>
      </div>
      {/* Mockup 03: "Save as default for this manga" · "Reset". */}
      <footer className="mt-auto flex flex-col gap-2 border-t border-ctp-surface1 px-4 py-3">
        {mangaOverride ? (
          <>
            <p className="flex items-center gap-2 text-xs">
              <BookMarked className="size-3.5 shrink-0 text-primary" />
              <span className="font-medium text-primary">{t('reader.settings.mangaOverride')}</span>
            </p>
            <p className="text-[11px] text-ctp-subtext0">{t('reader.settings.mangaOverrideHint')}</p>
            <Button variant="ghost" size="sm" className="self-start" onClick={onResetManga}>
              <RotateCcw />
              {t('reader.settings.resetManga')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-ctp-subtext0">{t('reader.settings.globalHint')}</p>
            <Button variant="ghost" size="sm" className="self-start text-primary" onClick={onSaveForManga}>
              <Save />
              {t('reader.settings.saveForManga')}
            </Button>
          </>
        )}
      </footer>
    </aside>
  );
}
