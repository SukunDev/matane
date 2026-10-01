// Detail header colours from the cover (BRAINSTORM.md §6.6): the cover's dominant colour, adjusted
// so a button in it stays readable with the theme's text on accent (crust on dark, base on Latte).

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface CoverTint {
  /** Background of the main buttons (CSS colour). */
  accent: string;
  /** Text on `accent`. */
  onAccent: string;
  /** A light wash of the colour for the header backdrop. */
  wash: string;
}

/** Text on accent per scheme: Catppuccin crust (Mocha) and base (Latte). */
const ON_ACCENT = { dark: '#11111b', light: '#eff1f5' } as const;
/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;
/** Covers with less colour than this (chroma, max − min channel) give no tint: the accent stays. */
const MIN_CHROMA = 0.1;

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return match ? ([1, 2, 3].map((i) => parseInt(match[i]!, 16) / 255) as [number, number, number]) : null;
}

function toHsl([r, g, b]: [number, number, number]): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function toRgb({ h, s, l }: Hsl): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const css = ([r, g, b]: [number, number, number], alpha = 1) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}${alpha < 1 ? ` / ${alpha}` : ''})`;

/**
 * The header tint for a cover colour, or null for a grey cover or no colour. Dark themes get a
 * pastel (light) version, Latte a deep one; the lightness moves until the text on it reads well.
 */
export function coverTint(hex: string | null, scheme: 'dark' | 'light'): CoverTint | null {
  const rgb = hex ? parseHex(hex) : null;
  if (!rgb) return null;
  if (Math.max(...rgb) - Math.min(...rgb) < MIN_CHROMA) return null;
  const hsl = toHsl(rgb);
  const onAccent = ON_ACCENT[scheme];
  const text = parseHex(onAccent)!;
  const tone: Hsl = {
    h: hsl.h,
    s: Math.min(Math.max(hsl.s, 0.45), 0.85),
    l: scheme === 'dark' ? Math.min(Math.max(hsl.l, 0.65), 0.85) : Math.min(Math.max(hsl.l, 0.3), 0.45),
  };
  // Lighter on dark themes, darker on Latte, until the text contrasts enough.
  const step = scheme === 'dark' ? 0.02 : -0.02;
  while (contrast(toRgb(tone), text) < MIN_CONTRAST && tone.l > 0.05 && tone.l < 0.95) tone.l += step;
  const accent = toRgb(tone);
  return { accent: css(accent), onAccent, wash: css(accent, scheme === 'dark' ? 0.16 : 0.22) };
}
