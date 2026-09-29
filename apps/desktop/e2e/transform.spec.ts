import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { type TestApp, launchApp } from './support/app';
import { QUADRANTS, SECURE_MODES, extensionFiles } from './support/site';

// Phase 4d: protected images restored through transformImage (XOR, AES via crypto.aesDecrypt,
// tile shuffle rebuilt with sharp), and migrateUrl after an update changes how urls look.
test.describe.configure({ mode: 'serial' });

let t: TestApp;
let page: Page;

const goto = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
type Rgb = [number, number, number];

/** Colours near the four corners of an image. */
async function corners(bytes: Buffer): Promise<Record<keyof typeof QUADRANTS, Rgb>> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgb => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  return {
    tl: at(5, 5),
    tr: at(info.width - 6, 5),
    bl: at(5, info.height - 6),
    br: at(info.width - 6, info.height - 6),
  };
}

/** A page as the reader gets it (through `manga://`), fetched in main. */
const servedPage = async (chapterId: number, index: number) =>
  Buffer.from(
    await t.app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).toString('base64');
    }, `manga://page/${chapterId}/${index}`),
    'base64',
  );

function readZip(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) =>
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

async function openManga(sourceId: string, query: string, title: string): Promise<number> {
  await goto(`#/browse/sources/${sourceId}?tab=search&q=${query}`);
  await page.getByText(title).first().click();
  await expect(page.getByTestId('chapter-row').first()).toBeVisible();
  return Number(/manga\/(\d+)/.exec(await page.evaluate(() => location.hash))![1]);
}

const chapters = (mangaId: number) =>
  page.evaluate((id) => window.api.invoke('chapters.list', { mangaId: id }), mangaId) as Promise<
    { id: number; name: string; url: string; read: boolean }[]
  >;

test.beforeAll(async () => {
  t = await launchApp(['demo', 'secure']);
  page = t.page;
});

test.afterAll(async () => {
  await t?.close();
});

test('the reader shows protected pages restored: XOR, tiles, AES + tiles, plain', async () => {
  const mangaId = await openManga('e2e-secure/en', 'paged', 'Paged Hero');
  const ch1 = (await chapters(mangaId)).find((c) => c.name === 'Ch. 1')!;
  await goto(`#/reader/${ch1.id}`);
  await expect(page.getByText('1 / 4').first()).toBeVisible();
  for (let index = 0; index < SECURE_MODES.length; index++) {
    const restored = await corners(await servedPage(ch1.id, index));
    // Encoded again as PNG: exact colours.
    expect(restored, SECURE_MODES[index]).toEqual(QUADRANTS);
  }
  // The pixels shown come straight from these bytes: the reader's images load.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLImageElement>('img[src^="manga://page/"]')].filter(
            (i) => i.complete && i.naturalWidth === 120,
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(1);
});

test('a download stores the restored pages, and cached pages open with the site down', async () => {
  const mangaId = await openManga('e2e-secure/en', 'paged', 'Paged Hero');
  const ch2 = (await chapters(mangaId)).find((c) => c.name === 'Ch. 2')!;
  await page.evaluate((id) => window.api.invoke('downloads.enqueue', { chapterIds: [id] }), ch2.id);
  const item = async () =>
    (
      (await page.evaluate(() => window.api.invoke('downloads.list'))) as {
        chapterId: number;
        status: string;
        path: string | null;
      }[]
    ).find((d) => d.chapterId === ch2.id);
  await expect.poll(async () => (await item())?.status, { timeout: 20_000 }).toBe('done');
  const files = await readZip((await item())!.path!);
  const pages = [...files.keys()].filter((name) => name.endsWith('.png')).sort();
  expect(pages).toHaveLength(4);
  for (const name of pages) expect(await corners(files.get(name)!), name).toEqual(QUADRANTS);

  // Ch. 1 was only read (cached, restored): it needs neither the site nor the extension.
  const ch1 = (await chapters(mangaId)).find((c) => c.name === 'Ch. 1')!;
  t.site.down = true;
  try {
    expect(await corners(await servedPage(ch1.id, 1))).toEqual(QUADRANTS);
  } finally {
    t.site.down = false;
  }
});

test('an update that changes the url scheme migrates library, progress and downloads', async () => {
  const mangaId = await openManga('e2e-demo/en', 'paged', 'Paged Hero');
  await page.getByRole('button', { name: 'Add to library' }).click();
  const before = await chapters(mangaId);
  const ch1 = before.find((c) => c.name === 'Ch. 1')!;
  const ch2 = before.find((c) => c.name === 'Ch. 2')!;
  await page.evaluate((id) => window.api.invoke('chapters.markRead', { chapterIds: [id], read: true }), ch1.id);
  await page.evaluate((id) => window.api.invoke('downloads.enqueue', { chapterIds: [id] }), ch2.id);
  await expect
    .poll(
      async () =>
        (
          (await page.evaluate(() => window.api.invoke('downloads.list'))) as { chapterId: number; status: string }[]
        ).find((d) => d.chapterId === ch2.id)?.status,
    )
    .toBe('done');

  // v2 of the dev extension: "m:paged" and "c:paged/1" from now on. The dev folder hot-reloads.
  const folder = join(t.home, 'e2e-demo');
  for (const [name, content] of Object.entries(
    extensionFiles(t.site.origin, 'demo', { version: '2.0.0', urlScheme: 'v2' }),
  )) {
    writeFileSync(join(folder, name), content);
  }
  await expect
    .poll(async () => (await chapters(mangaId)).map((c) => c.url).sort(), { timeout: 15_000 })
    .toEqual(before.map((c) => `c:${c.url}`).sort());

  // A refresh with the new version keeps the same chapters: nothing removed or added again.
  const refreshed = (await page.evaluate(
    (id) => window.api.invoke('manga.refresh', { mangaId: id, requestId: 'migrate' }),
    mangaId,
  )) as { manga: { url: string }; newChapterIds: number[] };
  expect(refreshed.newChapterIds).toEqual([]);
  expect(refreshed.manga.url).toBe('m:paged');
  const after = await chapters(mangaId);
  expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  expect(after.find((c) => c.id === ch1.id)?.read).toBe(true);

  // The download still reads (no network needed), and new pages come through the new urls.
  t.site.down = true;
  try {
    expect((await servedPage(ch2.id, 0)).byteLength).toBeGreaterThan(0);
  } finally {
    t.site.down = false;
  }
  const ch3 = after.find((c) => c.name === 'Ch. 3')!;
  expect((await servedPage(ch3.id, 0)).byteLength).toBeGreaterThan(0);
  expect(t.site.hits.some((hit) => hit.startsWith('/img/page/paged/3/0.png'))).toBe(true);

  // The extension log tells what happened.
  const log = (await page.evaluate(() => window.api.invoke('extensions.logs', { extensionId: 'e2e-demo' }))) as {
    message: string;
  }[];
  expect(log.map((l) => l.message)).toContainEqual(
    expect.stringMatching(/^migrateUrl 1\.0\.0 → 2\.0\.0: 1 manga and 4 chapters updated, 0 kept$/),
  );
});
