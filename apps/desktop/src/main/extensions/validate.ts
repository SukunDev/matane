import type { Chapter, Filter, MangaDetails, MangaPage, Page } from '@manga-reader/extension-sdk';
import { MANGA_STATUSES, MANGA_TYPES } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import { z } from 'zod';

// Extension output is untrusted: validate it before it reaches the DB or the renderer. Optional
// fields that are malformed are dropped rather than failing the whole result.

const text = (max: number) => z.string().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .catch(undefined)
    .transform((v) => v || undefined);
const optionalHttpUrl = z
  .string()
  .max(4096)
  .regex(/^https?:\/\//)
  .nullish()
  .catch(undefined)
  .transform((v) => v ?? undefined);
const optionalNumber = z
  .number()
  .finite()
  .nullish()
  .catch(undefined)
  .transform((v) => v ?? undefined);
const entityUrl = text(2048).min(1);

const summary = z.object({ url: entityUrl, title: text(1000), thumbnailUrl: optionalHttpUrl });

const mangaPageSchema = z.object({ items: z.array(summary).max(1000), hasNextPage: z.boolean().catch(false) });

const mangaDetailsSchema = summary.extend({
  author: optionalText(1000),
  artist: optionalText(1000),
  description: optionalText(50_000),
  genres: z.array(text(200)).max(200).catch([]).optional(),
  status: z.enum(MANGA_STATUSES).catch('unknown'),
  type: z.enum(MANGA_TYPES).optional().catch(undefined),
});

const chapterSchema = z.object({
  url: entityUrl,
  name: text(1000),
  number: optionalNumber,
  scanlator: optionalText(500),
  uploadedAt: optionalNumber,
});

const pageSchema = z
  .object({ index: z.number().int().nonnegative(), imageUrl: optionalHttpUrl, url: optionalText(4096) })
  .refine((p) => p.imageUrl !== undefined || p.url !== undefined, 'page needs imageUrl or url');

// Filters are rendered generically by the UI; check the discriminant and ids, keep the rest.
const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('header'), label: text(200) }),
    z.object({ type: z.literal('separator') }),
    z.object({ type: z.literal('group'), id: text(200), label: text(200), filters: z.array(filterSchema).max(2000) }),
    z.looseObject({
      type: z.enum(['text', 'select', 'checkbox', 'tristate', 'sort']),
      id: text(200),
      label: text(200),
    }),
  ]),
) as z.ZodType<Filter>;

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new AppError(
      'parse',
      `Extension returned an invalid ${what}${where}: ${issue?.message ?? 'unknown problem'}`,
    );
  }
  return result.data;
}

export const validate = {
  mangaPage: (value: unknown): MangaPage => parse(mangaPageSchema, value, 'manga list'),
  mangaDetails: (value: unknown): MangaDetails => parse(mangaDetailsSchema, value, 'manga'),
  chapters: (value: unknown): Chapter[] => parse(z.array(chapterSchema).max(20_000), value, 'chapter list'),
  pages: (value: unknown): Page[] => parse(z.array(pageSchema).max(5000), value, 'page list'),
  filters: (value: unknown): Filter[] => parse(z.array(filterSchema).max(500), value, 'filter list'),
  summaryOrNull: (value: unknown) => (value === null ? null : parse(summary, value, 'manga')),
  capabilities: (value: unknown) =>
    parse(z.object({ baseUrl: z.string(), capabilities: z.array(z.string()) }), value, 'source info'),
};
