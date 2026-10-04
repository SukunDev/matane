import sharp from 'sharp';
import { type MangaRepository, type MangaRow, coverColorOf, coverKeyOf } from '../db/repositories/manga';
import type { ServedImage } from './service';

const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
const HUE_BINS = 24;
/** Pixels with less colour than this (chroma 0–255) are left out: white, black and greys. */
const MIN_CHROMA = 40;

/**
 * The colour a cover is known by ("#rrggbb"): the most prominent hue among its colourful pixels,
 * weighted by how colourful they are, so a white background or black line art does not win. A
 * cover without colour gives its most common colour (and so no tint in the header).
 */
export async function dominantColor(input: Uint8Array | string): Promise<string> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .resize(48, 48, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (chroma < MIN_CHROMA) continue;
    const hue = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    const bin = bins[Math.floor((hue / 6) * HUE_BINS) % HUE_BINS]!;
    bin.weight += chroma;
    bin.r += r * chroma;
    bin.g += g * chroma;
    bin.b += b * chroma;
  }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.weight === 0) {
    const { dominant } = await sharp(input, { failOn: 'none' }).stats();
    return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  }
  return `#${hex(best.r / best.weight)}${hex(best.g / best.weight)}${hex(best.b / best.weight)}`;
}

/**
 * Measures cover colours for the detail header (docs/BRAINSTORM.md §6.6), one at a time in the
 * background: when a cover is served without a colour for it, and for library manga at start.
 */
export class CoverColors {
  private readonly queued = new Set<number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: {
      manga: Pick<MangaRepository, 'get' | 'setCoverColor'>;
      log?: (message: string) => void;
    },
  ) {}

  /** A cover was served: measure it unless its colour is known. */
  noticed(row: MangaRow, image: ServedImage): void {
    const key = coverKeyOf(row);
    if (!key || coverColorOf(row) || this.queued.has(row.id)) return;
    this.queued.add(row.id);
    const input = 'data' in image ? image.data : image.path;
    this.chain = this.chain
      .then(async () => {
        // The cover may have changed while waiting; then the newer one gets its own turn.
        if (coverKeyOf(this.deps.manga.get(row.id) ?? row) !== key) return;
        this.deps.manga.setCoverColor(row.id, await dominantColor(input), key);
      })
      .catch((error: unknown) => this.deps.log?.(`cover colour of manga ${row.id}: ${String(error)}`))
      .finally(() => this.queued.delete(row.id));
  }

  /** Waits for what is queued (tests, backfill pacing). */
  idle(): Promise<void> {
    return this.chain;
  }
}
