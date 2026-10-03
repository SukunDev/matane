// Performance benchmarks against the built app (BRAINSTORM.md §10 targets: start under 2 s, a
// library of 1,000+ manga scrolls smoothly, webtoon memory stays flat on long chapters).
//
//   pnpm build && pnpm bench               # all three, results printed as a Markdown table
//   pnpm bench -- --only startup|scroll|webtoon [--runs 5] [--json results.json]
//
// Everything is local: a small HTTP server serves 1,000 manga, covers and a 200-page chapter, and
// a throwaway profile (XDG_CONFIG_HOME in a temp folder) is seeded straight in SQLite. Run it on
// an idle machine; numbers vary by hardware, so compare runs on the same computer.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as unknown as string;
const appDir = resolve(import.meta.dirname, '../..');

const MANGA = 1000;
const CHAPTERS_PER_MANGA = 20;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const STRIP_PAGES = Number(option('--pages') ?? 200);

const only = option('--only');
const runs = Number(option('--runs') ?? 5);
const jsonOut = option('--json');

// ── Local site ────────────────────────────────────────────────────────────────────────────
const images = new Map<string, Buffer>();
async function image(key: string, width: number, height: number, n: number): Promise<Buffer> {
  let bytes = images.get(key);
  if (!bytes) {
    const hue = (n * 47) % 360;
    // A gradient with a stripe, so pages are not trivially compressible single colours.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 90) % 360},60%,40%)"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/><rect y="${height / 2 - 40}" width="100%" height="80" fill="#fff"/>
      <text x="40" y="${height / 2 + 20}" font-size="56" font-family="sans-serif">${key}</text></svg>`;
    bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
    images.set(key, bytes);
  }
  return bytes;
}

async function startSite() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const json = (body: unknown) =>
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const jpeg = (bytes: Buffer) => response.writeHead(200, { 'content-type': 'image/jpeg' }).end(bytes);
    let match: RegExpExecArray | null;
    if (url.pathname === '/api/list') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const items = Array.from({ length: 50 }, (_, i) => (page - 1) * 50 + i).filter((n) => n < MANGA);
      return json({
        items: items.map((n) => ({ id: `m${n}`, title: `Bench Manga ${n + 1}` })),
        more: page * 50 < MANGA,
      });
    }
    if ((match = /^\/img\/cover\/m(\d+)\.jpg$/.exec(url.pathname))) {
      void image(`cover ${match[1]}`, 300, 450, Number(match[1])).then(jpeg);
      return;
    }
    if ((match = /^\/img\/page\/(\d+)\.jpg$/.exec(url.pathname))) {
      void image(`page ${match[1]}`, 800, 1400, Number(match[1])).then(jpeg);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://bench.localhost:${port}` };
}

function extensionFiles(origin: string): Record<string, string> {
  const manifest = {
    id: 'bench',
    name: 'Bench',
    version: '1.0.0',
    apiVersion: 1,
    nsfw: false,
    rateLimit: { requests: 1000, perMs: 1000 },
    sources: [{ key: 'en', lang: 'en', name: 'Bench' }],
  };
  const code = `globalThis.__extension = {
  createSource: () => {
    const base = ${JSON.stringify(origin)};
    const toPage = (data) => ({ items: data.items.map((m) => ({ url: m.id, title: m.title, thumbnailUrl: base + '/img/cover/' + m.id + '.jpg' })), hasNextPage: data.more });
    return {
      baseUrl: base,
      getPopular: async (page) => toPage((await http.get(base + '/api/list?page=' + page, { responseType: 'json' })).body),
      search: async (query, page) => toPage((await http.get(base + '/api/list?page=' + page, { responseType: 'json' })).body),
      getMangaDetails: async (manga) => ({ url: manga.url, title: 'Bench Manga', type: 'manhwa', status: 'ongoing', thumbnailUrl: base + '/img/cover/' + manga.url + '.jpg' }),
      getChapters: async (manga) => Array.from({ length: ${CHAPTERS_PER_MANGA} }, (_, i) => ({ url: manga.url + '/' + (${CHAPTERS_PER_MANGA} - i), name: 'Ch. ' + (${CHAPTERS_PER_MANGA} - i), number: ${CHAPTERS_PER_MANGA} - i })),
      getPages: async (chapter) => Array.from({ length: chapter.url === 'm0/1' ? ${STRIP_PAGES} : 4 }, (_, index) => ({ index, imageUrl: base + '/img/page/' + index + '.jpg' })),
    };
  },
};`;
  return { 'manifest.json': JSON.stringify(manifest, null, 2), 'index.js': code };
}

// ── App and profile ───────────────────────────────────────────────────────────────────────
async function launch(home: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [appDir, ...(process.env['CI'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), MATANE_E2E_NO_ONBOARDING: '1' },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 860));
  return { app, page };
}

/** A profile with the bench extension and 1,000 library manga of 20 chapters each. */
async function seedProfile(origin: string): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'matane-bench-'));
  const extDir = join(home, 'ext-bench');
  mkdirSync(extDir);
  for (const [name, content] of Object.entries(extensionFiles(origin))) writeFileSync(join(extDir, name), content);
  const { app, page } = await launch(home);
  await page.waitForSelector('aside');
  await page.evaluate(
    async (folder) => {
      const { downloads } = await window.api.invoke('settings.get');
      await window.api.invoke('settings.set', { downloads: { ...downloads, folder } });
      await window.api.invoke('extensions.loadDevFolder', { path: folder.replace(/downloads$/, 'ext-bench') });
    },
    join(home, 'downloads'),
  );
  await app.close();

  const sqlite = require.resolve('better-sqlite3', { paths: [appDir] });
  const db = join(home, 'config', 'Matane', 'data.db');
  const script = `const Database = require(${JSON.stringify(sqlite)});
    const db = new Database(${JSON.stringify(db)});
    const now = Date.now();
    const manga = db.prepare("INSERT INTO manga (source_id, url, title, genres_json, status, type, thumbnail_url, in_library, added_at, latest_chapter_at, created_at, updated_at) VALUES ('bench/en', ?, ?, '[\\"Action\\"]', 'ongoing', 'manhwa', ?, 1, ?, ?, ?, ?)");
    const chapter = db.prepare("INSERT INTO chapters (manga_id, url, name, number, source_order, fetched_at, read) VALUES (?, ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (let n = 0; n < ${MANGA}; n++) {
        const id = manga.run('m' + n, 'Bench Manga ' + (n + 1), ${JSON.stringify(origin)} + '/img/cover/m' + n + '.jpg', now - n * 1000, now - n * 60000, now, now).lastInsertRowid;
        for (let c = ${CHAPTERS_PER_MANGA}; c >= 1; c--) chapter.run(id, 'm' + n + '/' + c, 'Ch. ' + c, c, ${CHAPTERS_PER_MANGA} - c, now, c <= n % ${CHAPTERS_PER_MANGA} ? 1 : 0);
      }
    })();
    db.close();`;
  execFileSync(electronPath, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  return home;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length * p) / 100))]!;

// ── Benchmarks ────────────────────────────────────────────────────────────────────────────
/** Launch → first library cover on screen, and the main process's own start to that point. */
async function benchStartup(home: string) {
  const wall: number[] = [];
  const sinceProcess: number[] = [];
  // The first run fills the cover cache; it is a warm-up and not counted.
  for (let i = 0; i <= runs; i++) {
    const started = performance.now();
    const { app, page } = await launch(home);
    await page.locator('[data-testid="library-item"] img').first().waitFor({ state: 'visible', timeout: 60_000 });
    const elapsed = performance.now() - started;
    const uptime = await app.evaluate(() => process.uptime() * 1000);
    await app.close();
    if (i === 0) continue;
    wall.push(elapsed);
    sinceProcess.push(uptime);
  }
  return { launchToLibraryMs: Math.round(median(wall)), mainProcessUptimeMs: Math.round(median(sinceProcess)), runs };
}

/** Scrolls the 1,000-manga grid down and up for a few seconds and records frame times. */
async function benchScroll(home: string) {
  const { app, page } = await launch(home);
  await page.locator('[data-testid="library-item"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  // The display's own frame rate (nothing moving), to read the scroll numbers against.
  const idle = await page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const deltas: number[] = [];
        let last = performance.now();
        const step = (now: number) => {
          deltas.push(now - last);
          last = now;
          if (deltas.length < 120) requestAnimationFrame(step);
          else done(deltas.slice(1));
        };
        requestAnimationFrame(step);
      }),
  );
  // Scrolls down and up for 6 s at `speed` px per frame, from the top.
  const scroll = (speed: number) =>
    page.evaluate(
      (pxPerFrame) =>
        new Promise<number[]>((done) => {
          const scroller = document.querySelector('[data-testid="library-scroll"]')!;
          scroller.scrollTop = 0;
          const deltas: number[] = [];
          let last = performance.now();
          let direction = 1;
          const end = last + 6000;
          const step = (now: number) => {
            deltas.push(now - last);
            last = now;
            scroller.scrollTop += direction * pxPerFrame;
            if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) direction = -1;
            if (scroller.scrollTop <= 0) direction = 1;
            if (now < end) requestAnimationFrame(step);
            else done(deltas.slice(1));
          };
          requestAnimationFrame(step);
        }),
      speed,
    );
  const summary = (frames: number[]) => {
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    return {
      meanFps: Math.round(1000 / mean),
      p95FrameMs: Number(percentile(frames, 95).toFixed(1)),
      longFrames: frames.filter((f) => f > 50).length,
    };
  };
  // A wheel-like pace first (covers load as they come), then dragging the scrollbar fast.
  const normal = summary(await scroll(20));
  const fast = summary(await scroll(60));
  const items = await page.locator('[data-testid="library-item"]').count();
  await app.close();
  const displayFps = Math.round(1000 / (idle.reduce((a, b) => a + b, 0) / idle.length));
  return { manga: MANGA, displayFps, normal1200pxPerS: normal, fast3600pxPerS: fast, itemsInDom: items };
}

/** Reads the 200-page chapter as a webtoon strip and samples the renderer's memory. */
async function benchWebtoon(home: string) {
  const { app, page } = await launch(home);
  await page.locator('[data-testid="library-item"]').first().waitFor({ timeout: 60_000 });
  // The seeded manga get ids in order: "Bench Manga 1" (m0) is 1.
  const chapterId = await page.evaluate(async () => {
    const list = (await window.api.invoke('chapters.list', { mangaId: 1 })) as { id: number; url: string }[];
    return list.find((c) => c.url === 'm0/1')!.id;
  });
  await page.evaluate((id) => (location.hash = `#/reader/${id}`), chapterId);
  const scroller = page.locator('[data-zoom]').first();
  await scroller.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  const rendererMb = async () => {
    const metrics = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
      return electronApp.getAppMetrics().find((m) => m.pid === pid)?.memory.workingSetSize ?? 0;
    });
    return Math.round(metrics / 1024);
  };
  const heapMb = () =>
    page.evaluate(() =>
      Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 2 ** 20),
    );
  const samples: { page: number; rendererMb: number; heapMb: number }[] = [
    { page: 0, rendererMb: await rendererMb(), heapMb: await heapMb() },
  ];
  const every = Math.max(10, Math.round(STRIP_PAGES / 10));
  for (let target = every; target <= STRIP_PAGES; target += every) {
    // Scroll in screen-sized steps until the target page is on screen (pages load as they come).
    for (let i = 0; i < 400; i++) {
      const at = await page.evaluate(() => {
        const s = document.querySelector('[data-zoom]')!;
        s.scrollTop += s.clientHeight * 0.9;
        // Rows of the strip: pages in order (data-index), then the chapter's end.
        const shown = [...s.querySelectorAll<HTMLElement>('[data-index]')].find(
          (e) => e.getBoundingClientRect().bottom > s.getBoundingClientRect().top + 10,
        );
        return Number(shown?.dataset['index'] ?? 0);
      });
      if (at >= target - 1) break;
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);
    samples.push({ page: target, rendererMb: await rendererMb(), heapMb: await heapMb() });
  }
  // Leaving the reader: what the strip held should be given back.
  await page.evaluate(() => (location.hash = '#/library'));
  await page.waitForTimeout(3000);
  const afterCloseMb = await rendererMb();
  await app.close();
  const values = samples.map((s) => s.rendererMb);
  return {
    pages: STRIP_PAGES,
    startMb: values[0]!,
    peakMb: Math.max(...values),
    endMb: values.at(-1)!,
    afterCloseMb,
    heapStartMb: samples[0]!.heapMb,
    heapEndMb: samples.at(-1)!.heapMb,
    samples,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────
const site = await startSite();
const home = await seedProfile(site.origin);
const results: Record<string, unknown> = {};
try {
  if (!only || only === 'startup') results['startup'] = await benchStartup(home);
  if (!only || only === 'scroll') results['scroll'] = await benchScroll(home);
  if (!only || only === 'webtoon') results['webtoon'] = await benchWebtoon(home);
} finally {
  site.server.close();
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
