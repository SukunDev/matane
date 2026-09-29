import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRepoKey, readExtensionArchive, sha256Hex } from '@matane/extension-runtime/repo';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtension } from './create.js';
import { buildRepo, repoKeygen, verifyRepo } from './repo.js';

// Scratch dirs live inside the package so the scaffold resolves the workspace SDK.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(packageDir, '.test-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

// A tiny valid PNG is not needed: the icon is copied as bytes.
const ICON = Buffer.from('89504e470d0a1a0a-not-really-a-png', 'utf8');

/** A source extension (scaffolded, with an icon) and a prebuilt one (manifest.json + index.js). */
async function extensions(): Promise<string[]> {
  const parent = await scratch();
  const source = await createExtension(parent, { id: 'alpha', domain: 'alpha.example', lang: 'id' });
  await writeFile(path.join(source, 'icon.png'), ICON);
  const built = path.join(parent, 'beta-dist');
  await mkdir(built);
  await writeFile(
    path.join(built, 'manifest.json'),
    JSON.stringify({
      id: 'beta',
      name: 'Beta',
      version: '2.0.0',
      apiVersion: 1,
      description: 'Prebuilt',
      domains: ['beta.example'],
      sources: [{ key: 'en', lang: 'en', name: 'Beta' }],
    }),
  );
  await writeFile(path.join(built, 'index.js'), 'globalThis.__extension = { createSource: () => ({}) };\n');
  // Given out of order on purpose: the index is sorted by id.
  return [built, source];
}

describe('mr-ext repo', () => {
  it('builds a signed repository that verifies', async () => {
    const key = generateRepoKey();
    const out = path.join(await scratch(), 'repo');
    const { index, signed } = await buildRepo({
      extensions: await extensions(),
      outDir: out,
      name: 'Test',
      privateKeyPem: key.privateKeyPem,
    });

    expect(signed).toBe(true);
    expect(index.publicKey).toBe(key.publicKey);
    expect(index.extensions.map((e) => [e.id, e.file, e.icon])).toEqual([
      ['alpha', 'extensions/alpha-0.1.0.zip', 'extensions/icons/alpha.png'],
      ['beta', 'extensions/beta-2.0.0.zip', null],
    ]);
    expect(index.extensions[1]).toMatchObject({ description: 'Prebuilt', langs: ['en'], nsfw: false });
    expect(await readFile(path.join(out, 'extensions/icons/alpha.png'))).toEqual(ICON);

    const zip = await readFile(path.join(out, 'extensions/alpha-0.1.0.zip'));
    expect(sha256Hex(zip)).toBe(index.extensions[0]!.sha256);
    const archive = await readExtensionArchive(zip, index.extensions[0]);
    expect(Object.keys(archive.files).sort()).toEqual(['icon.png', 'index.js', 'manifest.json']);

    const result = await verifyRepo({ source: out, publicKey: key.publicKey });
    expect(result.problems).toEqual([]);
    expect(result.signature).toEqual({ key: key.publicKey, valid: true, trusted: true });
  });

  it('is reproducible: two builds give the same bytes', async () => {
    const key = generateRepoKey();
    const exts = await extensions();
    const files = ['index.json', 'index.json.sig', 'extensions/alpha-0.1.0.zip', 'extensions/beta-2.0.0.zip'];
    const hashes = async (out: string) =>
      Promise.all(files.map(async (f) => sha256Hex(await readFile(path.join(out, f)))));

    const first = path.join(await scratch(), 'a');
    const second = path.join(await scratch(), 'b');
    await buildRepo({ extensions: exts, outDir: first, name: 'Test', privateKeyPem: key.privateKeyPem });
    await buildRepo({
      extensions: [...exts].reverse(),
      outDir: second,
      name: 'Test',
      privateKeyPem: key.privateKeyPem,
    });
    expect(await hashes(second)).toEqual(await hashes(first));
  });

  it('fails verification when one byte of index.json or an archive changes', async () => {
    const key = generateRepoKey();
    const out = path.join(await scratch(), 'repo');
    await buildRepo({ extensions: await extensions(), outDir: out, name: 'Test', privateKeyPem: key.privateKeyPem });

    const indexFile = path.join(out, 'index.json');
    const original = await readFile(indexFile);
    await writeFile(indexFile, Buffer.from(original.toString().replace('"Test"', '"Tost"')));
    expect((await verifyRepo({ source: out, publicKey: key.publicKey })).problems).toEqual([
      expect.stringMatching(/index\.json\.sig does not match index\.json/),
    ]);
    await writeFile(indexFile, original);

    const zipFile = path.join(out, 'extensions/beta-2.0.0.zip');
    const zip = await readFile(zipFile);
    zip[zip.length - 40]! ^= 1;
    await writeFile(zipFile, zip);
    expect((await verifyRepo({ source: out, publicKey: key.publicKey })).problems).toEqual([
      expect.stringMatching(/^extensions\/beta-2\.0\.0\.zip: sha256 mismatch/),
    ]);
  });

  it('reports a wrong key, an unsigned repo and missing files', async () => {
    const key = generateRepoKey();
    const out = path.join(await scratch(), 'repo');
    await buildRepo({ extensions: await extensions(), outDir: out, name: 'Test', privateKeyPem: key.privateKeyPem });
    const other = generateRepoKey().publicKey;
    expect((await verifyRepo({ source: out, publicKey: other })).problems).toEqual([
      expect.stringContaining(`for ${other}`),
    ]);
    // Without --public-key the index's own key is used, which proves integrity but not trust.
    expect((await verifyRepo({ source: out })).signature).toEqual({ key: key.publicKey, valid: true, trusted: false });

    await rm(path.join(out, 'extensions/icons/alpha.png'));
    expect((await verifyRepo({ source: out, publicKey: key.publicKey })).problems).toEqual([
      'extensions/icons/alpha.png is missing',
    ]);

    const unsigned = path.join(await scratch(), 'unsigned');
    const built = await buildRepo({ extensions: await extensions(), outDir: unsigned, name: 'Test' });
    expect(built.index.publicKey).toBeUndefined();
    expect((await verifyRepo({ source: unsigned })).problems).toEqual([
      expect.stringMatching(/index\.json\.sig is missing/),
    ]);
  });

  it('reads a repository over HTTP', async () => {
    const key = generateRepoKey();
    const out = path.join(await scratch(), 'repo');
    await buildRepo({ extensions: await extensions(), outDir: out, name: 'Test', privateKeyPem: key.privateKeyPem });
    const urls: string[] = [];
    const result = await verifyRepo({
      source: 'https://repo.example/ext',
      publicKey: key.publicKey,
      fetchBytes: async (url) => {
        urls.push(url);
        return readFile(path.join(out, url.replace('https://repo.example/ext/', ''))).catch(() => null);
      },
    });
    expect(result.problems).toEqual([]);
    expect(urls).toContain('https://repo.example/ext/extensions/alpha-0.1.0.zip');
  });

  it('rebuilds over its own output but never over another folder, and refuses duplicate ids', async () => {
    const exts = await extensions();
    const out = path.join(await scratch(), 'repo');
    await buildRepo({ extensions: exts, outDir: out, name: 'Test' });
    await writeFile(path.join(out, 'extensions/stale-0.0.1.zip'), 'old');
    await buildRepo({ extensions: exts.slice(0, 1), outDir: out, name: 'Test' });
    await expect(stat(path.join(out, 'extensions/stale-0.0.1.zip'))).rejects.toThrow();
    await expect(stat(path.join(out, 'extensions/alpha-0.1.0.zip'))).rejects.toThrow();

    const other = await scratch();
    await writeFile(path.join(other, 'notes.txt'), 'mine');
    await expect(buildRepo({ extensions: exts, outDir: other, name: 'Test' })).rejects.toThrow(/not a repository/);
    await expect(
      buildRepo({ extensions: [exts[0]!, exts[0]!], outDir: path.join(await scratch(), 'r'), name: 'Test' }),
    ).rejects.toThrow(/given twice/);
  });

  it('keygen writes a private key only it can read and never overwrites one', async () => {
    const file = path.join(await scratch(), 'key.pem');
    const publicKey = await repoKeygen(file);
    expect(publicKey).toMatch(/^ed25519:/);
    expect((await readFile(file, 'utf8')).startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(repoKeygen(file)).rejects.toThrow(/refusing to overwrite/);
  });
});
