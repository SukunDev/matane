import {
  type Chapter,
  type Filter,
  type FilterState,
  type ImageFetchResult,
  type MangaDetails,
  type MangaPage,
  type MangaSummary,
  type Page,
  type Preference,
  SDK_API_VERSION,
} from '@manga-reader/extension-sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExtensionRuntime, type RawImageTransform } from '@manga-reader/extension-runtime';
import { restoreImage, sniffImageType } from '@manga-reader/extension-runtime/image';
import { buildOrLoad } from './build';
import { CLI_NAME, CLI_VERSION, createNodeHost, nodeFetch } from './node-host';

export interface SmokeOptions {
  dir: string;
  /** Source keys to test; all sources when empty. */
  sources?: string[];
  query?: string;
  /** Resolve a web URL instead of browsing. */
  url?: string;
  /** Index of the manga (in the listing) to open. */
  pick?: number;
  prefs?: Record<string, unknown>;
  filters?: FilterState;
  /** Fetch the first page image (and call reportImage, and transformImage). */
  image?: boolean;
  /** Where a page restored by transformImage is written (default: `<dir>/.mr-ext/`). */
  outDir?: string;
  verbose?: boolean;
  print?: (line: string) => void;
}

const MAX_CANDIDATES = 5;

interface Call {
  <T>(method: string, args?: unknown[]): Promise<T>;
}

interface Hooks {
  key: string;
  transformImage(page: Page, bytes: Uint8Array): Promise<RawImageTransform>;
}

/** Runs the reading flow against the real site: list → details → chapters → pages → first image. */
export async function runSmokeTest(options: SmokeOptions): Promise<{ ok: boolean }> {
  const print = options.print ?? ((line: string) => console.log(line));
  const built = await buildOrLoad(options.dir);
  const { manifest } = built;
  print(`${manifest.name} ${manifest.version} · bundle ${(built.bytes / 1024).toFixed(1)} KB`);

  let requests = 0;
  const host = createNodeHost({
    manifest,
    log: (level, message) => print(`    [${level}] ${message}`),
    onRequest: (request, response, ms) => {
      requests++;
      if (options.verbose)
        print(`    → ${request.method ?? 'GET'} ${request.url} ${response?.status ?? 'ERR'} ${ms}ms`);
    },
  });
  const runtime = await ExtensionRuntime.create({
    code: built.code,
    manifest,
    host,
    hostInfo: { appName: CLI_NAME, appVersion: CLI_VERSION, apiVersion: SDK_API_VERSION },
  });

  let ok = true;
  try {
    const preferences = await runtime.call<Preference[]>('', '__preferences');
    const prefs = { ...Object.fromEntries(preferences.map((p) => [p.key, p.default])), ...options.prefs };
    if (preferences.length > 0) print(`preferences: ${JSON.stringify(prefs)}`);

    const keys = options.sources?.length ? options.sources : manifest.sources.map((s) => s.key);
    for (const key of keys) {
      const source = manifest.sources.find((s) => s.key === key);
      if (!source) throw new Error(`Unknown source "${key}" (have: ${manifest.sources.map((s) => s.key).join(', ')})`);
      print(`\n■ ${source.name} [${source.key}, ${source.lang}]`);
      const call: Call = <T>(method: string, args: unknown[] = []) => runtime.call<T>(key, method, args, { prefs });
      const hooks: Hooks = {
        key,
        transformImage: (page, bytes) => runtime.transformImage(key, page, bytes, { prefs }),
      };
      ok = (await testSource(call, hooks, options, print)) && ok;
    }
  } finally {
    runtime.dispose();
  }
  print(`\n${ok ? '✔ passed' : '✘ failed'} · ${requests} requests`);
  return { ok };
}

async function testSource(
  call: Call,
  hooks: Hooks,
  options: SmokeOptions,
  print: (line: string) => void,
): Promise<boolean> {
  let ok = true;
  const step = async <T>(
    label: string,
    run: () => Promise<T>,
    describe: (value: T) => string,
  ): Promise<T | undefined> => {
    const started = Date.now();
    try {
      const value = await run();
      print(`  ✔ ${label.padEnd(16)} ${describe(value)} (${Date.now() - started} ms)`);
      return value;
    } catch (error) {
      ok = false;
      print(`  ✘ ${label.padEnd(16)} ${(error as Error).message}`);
      return undefined;
    }
  };

  const info = await step(
    'info',
    () => call<{ baseUrl: string; capabilities: string[] }>('__info'),
    (i) => `${i.baseUrl} · ${i.capabilities.join(', ') || 'no optional methods'}`,
  );
  const has = (method: string) => info?.capabilities.includes(method) ?? false;

  if (has('getFilters'))
    await step(
      'getFilters',
      () => call<Filter[]>('getFilters'),
      (f) => `${countFilters(f)} filters`,
    );

  let candidates: MangaSummary[] = [];
  if (options.url) {
    if (!has('resolveUrl')) {
      print('  ✘ resolveUrl       not implemented');
      return false;
    }
    const resolved = await step(
      'resolveUrl',
      () => call<MangaSummary | null>('resolveUrl', [options.url]),
      (m) => (m ? `${m.url}` : 'null'),
    );
    if (resolved) candidates = [resolved];
  } else {
    const listing = options.query
      ? await step(
          `search "${options.query}"`,
          () => call<MangaPage>('search', [options.query, 1, options.filters ?? {}]),
          describePage,
        )
      : await step('getPopular', () => call<MangaPage>('getPopular', [1]), describePage);
    if (!options.query && has('getLatest'))
      await step('getLatest', () => call<MangaPage>('getLatest', [1]), describePage);
    if (listing) {
      if (listing.items.length === 0) ok = false;
      for (const problem of checkSummaries(listing.items)) {
        ok = false;
        print(`    ! ${problem}`);
      }
      // Without an explicit pick, skip titles that have no readable chapters in this language.
      candidates =
        options.pick === undefined
          ? listing.items.slice(0, MAX_CANDIDATES)
          : listing.items.slice(options.pick, options.pick + 1);
    }
  }
  if (candidates.length === 0) return false;

  let chapter: Chapter | undefined;
  for (const manga of candidates) {
    const details = await step(
      'getMangaDetails',
      () => call<MangaDetails>('getMangaDetails', [manga]),
      (d) => `"${d.title}" · ${d.status}${d.type ? ` · ${d.type}` : ''} · ${d.genres?.length ?? 0} genres`,
    );
    if (has('getWebUrl'))
      await step(
        'getWebUrl',
        () => call<string>('getWebUrl', [manga]),
        (u) => u,
      );
    const chapters = await step(
      'getChapters',
      () => call<Chapter[]>('getChapters', [details ?? manga]),
      (c) =>
        c.length > 0
          ? `${c.length} chapters · newest "${c[0]?.name}"${c[0]?.scanlator ? ` by ${c[0].scanlator}` : ''}`
          : '0 chapters',
    );
    chapter = chapters?.[0];
    if (chapter) break;
  }
  if (!chapter) {
    print('  ✘ no manga with readable chapters');
    return false;
  }
  if (has('getWebUrl'))
    await step(
      'getWebUrl',
      () => call<string>('getWebUrl', [chapter]),
      (u) => u,
    );

  const pages = await step(
    'getPages',
    () => call<Page[]>('getPages', [chapter]),
    (p) => `${p.length} pages`,
  );
  const first = pages?.[0];
  if (!first || options.image === false) return ok;

  const imageUrl =
    first.imageUrl ??
    (await step(
      'getImageUrl',
      () => call<string>('getImageUrl', [first]),
      (u) => u,
    ));
  if (!imageUrl) return false;
  const headers = has('imageHeaders') ? await call<Record<string, string>>('imageHeaders') : {};
  const transforms = has('transformImage');
  const image = await step(
    'first image',
    () => fetchImage(imageUrl, headers, transforms),
    (r) => `${r.type} · ${(r.bytes / 1024).toFixed(0)} KB`,
  );
  if (image && transforms) {
    // What the app would show: the restored page, written to a file to look at.
    await step(
      'transformImage',
      async () => {
        const transform = await hooks.transformImage(first, image.data);
        const restored = await restoreImage(image.data, transform as Parameters<typeof restoreImage>[1]);
        const type = sniffImageType(restored);
        if (!type) throw new Error('the restored page is not an image');
        const outDir = path.resolve(options.outDir ?? path.join(options.dir, '.mr-ext'));
        await mkdir(outDir, { recursive: true });
        const file = path.join(outDir, `${hooks.key}-page-${first.index + 1}.${type.slice(6).replace('jpeg', 'jpg')}`);
        await writeFile(file, restored);
        const what = [transform.bytes ? 'bytes' : '', transform.tiles ? 'tiles' : ''].filter(Boolean).join(' + ');
        return `${what || 'unchanged'} → ${file}`;
      },
      (d) => d,
    );
  }
  if (image && has('reportImage')) {
    await step(
      'reportImage',
      () => call<null>('reportImage', [image.report]),
      () => 'sent',
    );
  }
  return ok && image !== undefined;
}

/** The first page image; protected images (`anyType`) may come with any content type. */
async function fetchImage(url: string, headers: Record<string, string>, anyType = false) {
  const started = Date.now();
  const response = await nodeFetch({ url, headers, responseType: 'bytes' });
  const data = Buffer.from(response.body as string, 'base64');
  const bytes = data.length;
  const type = response.headers['content-type'] ?? 'unknown';
  const success = response.status === 200 && (anyType || type.startsWith('image/'));
  const report: ImageFetchResult = {
    url,
    success,
    bytes,
    durationMs: Date.now() - started,
    cached: (response.headers['x-cache'] ?? '').startsWith('HIT'),
  };
  if (!success) throw new Error(`HTTP ${response.status} (${type})`);
  return { type, bytes, data, report };
}

function describePage(page: MangaPage): string {
  const titles = page.items.slice(0, 3).map((m) => `"${m.title}"`);
  return `${page.items.length} items${page.hasNextPage ? ' (+more)' : ''} · ${titles.join(', ')}`;
}

function checkSummaries(items: MangaSummary[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.url !== 'string' || item.url === '') problems.push(`item without url: ${JSON.stringify(item)}`);
    if (typeof item.title !== 'string' || item.title === '') problems.push(`item without title: ${item.url}`);
    if (seen.has(item.url)) problems.push(`duplicate url ${item.url}`);
    seen.add(item.url);
  }
  return problems;
}

function countFilters(filters: Filter[]): number {
  return filters.reduce(
    (n, f) =>
      n + (f.type === 'group' ? countFilters(f.filters) : f.type === 'header' || f.type === 'separator' ? 0 : 1),
    0,
  );
}
