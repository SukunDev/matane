import { useState } from 'react';
import { initials } from '../../lib/format';
import { cn } from '../../lib/utils';

// A stable Catppuccin accent per extension, so sources are easy to tell apart without icons.
const COLORS = ['peach', 'mauve', 'blue', 'green', 'pink', 'teal', 'yellow', 'sapphire', 'red', 'lavender'];

function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** The extension's icon.png when `src` is given and loads; otherwise coloured initials. */
export function SourceIcon({
  id,
  name,
  src = null,
  className,
}: {
  id: string;
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(src)}
        className={cn('size-10 shrink-0 rounded-xl border bg-muted object-cover', className)}
      />
    );
  }
  const color = colorFor(id);
  return (
    <span
      aria-hidden
      style={{
        color: `var(--catppuccin-color-${color})`,
        backgroundColor: `color-mix(in oklab, var(--catppuccin-color-${color}) 15%, transparent)`,
        borderColor: `color-mix(in oklab, var(--catppuccin-color-${color}) 35%, transparent)`,
      }}
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border text-sm font-bold', className)}
    >
      {initials(name)}
    </span>
  );
}
