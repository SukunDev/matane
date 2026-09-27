import { Switch } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Building blocks of the settings sections: a labelled row, a switch, a segmented choice.

export function Row({
  label,
  description,
  children,
  htmlFor,
  stacked = false,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  htmlFor?: string;
  /** The control goes under the label (wide controls in a narrow column). */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-6 py-4 first:pt-0 last:pb-0',
        stacked ? 'flex-col gap-2' : 'items-center justify-between',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <Switch.Root
      id={id}
      checked={checked}
      aria-label={label}
      onCheckedChange={onChange}
      className="relative h-6 w-11 shrink-0 rounded-full bg-ctp-surface1 transition-colors data-[state=checked]:bg-primary"
    >
      <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground" />
    </Switch.Root>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs transition-colors',
            value === option
              ? 'bg-primary font-semibold text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}
