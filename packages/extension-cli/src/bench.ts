import type { Chapter, HttpRequest, HttpResponse, MangaDetails, MangaPage, MangaSummary } from '@matane/extension-sdk';
import { SDK_API_VERSION } from '@matane/extension-sdk';
import type { ExtensionManifest } from '@matane/extension-sdk/manifest';
import { DEFAULT_LIMITS, ExtensionRuntime, type HostApi } from '@matane/extension-runtime';
import { buildExtension } from './build.js';
import { createFixtureHost } from './fixtures.js';
import { CLI_NAME, CLI_VERSION, createNodeHost } from './node-host.js';

export interface BenchOptions {
  dir: string;
  runs?: number;
  /** Replay recorded responses instead of the network (repeatable numbers). */
  fixtures?: string;
  source?: string;
  /** Manga url to open instead of the first popular one (fixture sets record one manga). */
  manga?: string;
  /** Skip the synthetic stress cases. */
  skipSynthetic?: boolean;
  print?: (line: string) => void;
}

export interface Sample {
  name: string;
  /** Wall time per run, ms. */
  wall: number[];
  /** Part of the wall time spent waiting for the host's http, ms. */
  network: number[];
  /** QuickJS heap after the last run (live objects only; garbage is collected), bytes. */
  heap: number;
  /** Smallest heap limit the case still succeeds under, bytes (synthetic cases only). */
  minHeap?: number;
}

const MB = 1024 * 1024;

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** Wraps a host so every http wait is timed (sandbox time = wall − network). */
function timedHost(host: HostApi): { host: HostApi; take: () => number } {
  let network = 0;
  return {
    host: {
      ...host,
      async http(request) {
        const started = performance.now();
        try {
          return await host.http(request);
        } finally {
          network += performance.now() - started;
        }
      },
    },
    take: () => {
      const value = network;
      network = 0;
      return value;
    },
  };
}

async function measure<T>(
  sample: Sample,
  timer: { take: () => number },
  runtime: ExtensionRuntime,
  run: () => Promise<T>,
): Promise<T> {
  timer.take();
  const started = performance.now();
  const value = await run();
  sample.wall.push(performance.now() - started);
  sample.network.push(timer.take());
  sample.heap = runtime.memoryUsage();
  return value;
}

/**
 * Measures an extension's calls (sandbox vs network time, QuickJS heap) plus synthetic worst cases
 * that size the runtime limits (ADR 0003).
 */
export async function runBenchmark(options: BenchOptions): Promise<{ samples: Sample[] }> {
  const print = options.print ?? ((line: string) => console.log(line));
  const runs = options.runs ?? 5;
  const built = await buildExtension(options.dir, { write: false });
  const { manifest } = built;
  const key = options.source ?? manifest.sources[0]!.key;
  const baseHost: HostApi = options.fixtures
    ? createFixtureHost({ dir: options.fixtures })
    : createNodeHost({ manifest, log: () => undefined });
  const timer = timedHost(baseHost);
  const hostInfo = { appName: CLI_NAME, appVersion: CLI_VERSION, apiVersion: SDK_API_VERSION };

  const samples: Sample[] = [];
  const sample = (name: string) => {
    const s: Sample = { name, wall: [], network: [], heap: 0 };
    samples.push(s);
    return s;
  };

  const create = sample('create runtime');
  let runtime: ExtensionRuntime | undefined;
  for (let i = 0; i < runs; i++) {
    runtime?.dispose();
    const started = performance.now();
    runtime = await ExtensionRuntime.create({ code: built.code, manifest, host: timer.host, hostInfo });
    create.wall.push(performance.now() - started);
    create.network.push(0);
    create.heap = runtime.memoryUsage();
  }
  const rt = runtime!;
  try {
    print(
      `${manifest.name} ${manifest.version} · source ${key} · ${runs} runs · ${options.fixtures ? 'fixtures' : 'live network'}`,
    );
    const call = <T>(method: string, args: unknown[]) => rt.call<T>(key, method, args);
    const popular = sample('getPopular');
    const details = sample('getMangaDetails');
    const chapters = sample('getChapters');
    const pages = sample('getPages');
    for (let i = 0; i < runs; i++) {
      const list = await measure(popular, timer, rt, () => call<MangaPage>('getPopular', [1]));
      const manga: MangaSummary = options.manga ? { url: options.manga, title: '' } : list.items[0]!;
      const full = await measure(details, timer, rt, () => call<MangaDetails>('getMangaDetails', [manga]));
      const list2 = await measure(chapters, timer, rt, () => call<Chapter[]>('getChapters', [full]));
      if (list2[0]) await measure(pages, timer, rt, () => call('getPages', [list2[0]]));
    }
  } catch (error) {
    print(`benchmark failed: ${(error as Error).message}`);
    throw error;
  } finally {
    rt.dispose();
  }

  if (!options.skipSynthetic) samples.push(...(await syntheticCases(runs, hostInfo)));
  printTable(samples, print);
  return { samples };
}

// ------------------------------------------------------------------------------------ synthetic

const SYNTHETIC_MANIFEST: ExtensionManifest = {
  id: 'bench',
  name: 'Bench',
  version: '1.0.0',
  apiVersion: SDK_API_VERSION,
  nsfw: false,
  sources: [{ key: 'x', lang: 'en', name: 'Bench' }],
};

// Worst cases seen in the wild: a 5 MB JSON chapter feed (thousands of chapters), a 1 MB listing
// page with thousands of nodes (every `.text()`/`.attr()` crosses the bridge), and pure CPU.
const SYNTHETIC_CODE = `globalThis.__extension = { createSource: () => ({
  baseUrl: 'https://bench.example',
  async getChapters() {
    const res = await http.get('https://bench.example/feed.json');
    const data = JSON.parse(res.body);
    return data.chapters.map((c) => ({ url: c.id, name: 'Vol. ' + c.volume + ' Ch. ' + c.chapter + ' - ' + c.title, number: Number(c.chapter), scanlator: c.group, uploadedAt: Date.parse(c.date) }));
  },
  async getPopular() {
    const res = await http.get('https://bench.example/list.html');
    const doc = html.load(res.body, { baseUrl: 'https://bench.example' });
    const items = doc.select('.card').map((card) => ({ url: card.selectFirst('a').attr('href'), title: card.selectFirst('.title').text().trim(), thumbnailUrl: card.selectFirst('img').absUrl('src') }));
    return { items: items.slice(0, 50), hasNextPage: items.length > 50 };
  },
  async search() {
    let x = 0;
    for (let i = 0; i < 5000000; i++) x = (x + i * 31) % 1000003;
    return { items: [], hasNextPage: x < 0 };
  },
  async getMangaDetails() {}, async getPages() {},
}) };`;

function syntheticResponses(): Record<string, string> {
  const chapters = Array.from({ length: 10_000 }, (_, i) => ({
    id: `c${i}-${'x'.repeat(20)}`,
    volume: String(Math.floor(i / 10)),
    chapter: String(i),
    title: `A reasonably long chapter title number ${i} with some words`,
    group: `Scanlation Group ${i % 7}`,
    date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
    extra: { pages: 20, lang: 'en', external: null, hash: 'f'.repeat(40) },
  }));
  const cards = Array.from(
    { length: 3000 },
    (_, i) =>
      `<div class="card"><a href="/manga/${i}"><img src="/covers/${i}.jpg"></a><span class="title"> Title ${i} </span><p>${'lorem ipsum '.repeat(20)}</p></div>`,
  ).join('\n');
  return {
    'https://bench.example/feed.json': JSON.stringify({ chapters }),
    'https://bench.example/list.html': `<html><body>${cards}</body></html>`,
  };
}

async function syntheticCases(runs: number, hostInfo: { appName: string; appVersion: string; apiVersion: number }) {
  const bodies = syntheticResponses();
  const base: HostApi = {
    http: async (request: HttpRequest): Promise<HttpResponse> => ({
      status: 200,
      url: request.url,
      headers: {},
      body: bodies[request.url] ?? '',
    }),
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: () => undefined,
  };
  const timer = timedHost(base);
  const runtime = await ExtensionRuntime.create({
    code: SYNTHETIC_CODE,
    manifest: SYNTHETIC_MANIFEST,
    host: timer.host,
    hostInfo,
    // Generous limits: the point is to measure, not to trip them.
    limits: { memoryBytes: 512 * MB, syncMs: 60_000, callTimeoutMs: 120_000 },
  });
  const size = (url: string) => (Buffer.byteLength(bodies[url]!) / MB).toFixed(1);
  const cases: [string, string, unknown[]][] = [
    [
      `JSON feed ${size('https://bench.example/feed.json')} MB → 10k chapters`,
      'getChapters',
      [{ url: '/', title: '' }],
    ],
    [`HTML ${size('https://bench.example/list.html')} MB, 3k cards → 9k bridge calls`, 'getPopular', [1]],
    ['CPU loop 5M iterations', 'search', ['', 1, {}]],
  ];
  const samples: Sample[] = [];
  try {
    for (const [name, method, args] of cases) {
      const s: Sample = { name: `synthetic: ${name}`, wall: [], network: [], heap: 0 };
      for (let i = 0; i < runs; i++) await measure(s, timer, runtime, () => runtime.call('x', method, args));
      s.minHeap = await smallestHeap(base, hostInfo, method, args);
      samples.push(s);
    }
  } finally {
    runtime.dispose();
  }
  return samples;
}

/** Peak memory is not observable from outside, so find the smallest limit that still works. */
async function smallestHeap(
  host: HostApi,
  hostInfo: { appName: string; appVersion: string; apiVersion: number },
  method: string,
  args: unknown[],
): Promise<number | undefined> {
  for (const mb of [2, 4, 8, 16, 32, 64, 128, 256]) {
    const runtime = await ExtensionRuntime.create({
      code: SYNTHETIC_CODE,
      manifest: SYNTHETIC_MANIFEST,
      host,
      hostInfo,
      limits: { memoryBytes: mb * MB, syncMs: 60_000, callTimeoutMs: 120_000 },
    });
    try {
      await runtime.call('x', method, args);
      return mb * MB;
    } catch {
      // too small, try the next size
    } finally {
      runtime.dispose();
    }
  }
  return undefined;
}

function printTable(samples: Sample[], print: (line: string) => void) {
  const rows = samples.map((s) => {
    const sandbox = s.wall.map((w, i) => w - (s.network[i] ?? 0));
    return [
      s.name,
      percentile(s.wall, 50).toFixed(1),
      percentile(s.wall, 95).toFixed(1),
      percentile(sandbox, 50).toFixed(1),
      percentile(sandbox, 95).toFixed(1),
      (s.heap / MB).toFixed(1),
      s.minHeap === undefined ? '' : `≤ ${s.minHeap / MB}`,
    ];
  });
  const header = ['case', 'wall p50', 'wall p95', 'sandbox p50', 'sandbox p95', 'heap after MB', 'needs heap MB'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  print('');
  print(line(header));
  print(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) print(line(row));
  print('');
  print(
    `Current limits: heap ${DEFAULT_LIMITS.memoryBytes / MB} MB, sync ${DEFAULT_LIMITS.syncMs} ms, call ${DEFAULT_LIMITS.callTimeoutMs} ms (getChapters ${DEFAULT_LIMITS.methodTimeoutMs['getChapters']} ms). Times in ms.`,
  );
}
