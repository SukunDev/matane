import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtensionRuntime } from '@manga-reader/extension-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExtension } from './build';
import { createExtension } from './create';
import { createFixtureHost } from './fixtures';
import { RateLimiter } from './node-host';

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

describe('create + build', () => {
  it('scaffolds an extension that builds and loads in the sandbox', async () => {
    const dir = await createExtension(await scratch(), { id: 'demo', domain: 'demo.example', lang: 'id' });
    const result = await buildExtension(dir);

    expect(result.manifest).toMatchObject({ id: 'demo', domains: ['demo.example'], sources: [{ key: 'id' }] });
    expect(result.code).not.toMatch(/\bimport\b|\brequire\(/);
    expect(JSON.parse(await readFile(path.join(dir, 'dist/manifest.json'), 'utf8'))).toEqual(result.manifest);

    const runtime = await ExtensionRuntime.create({
      code: result.code,
      manifest: result.manifest,
      host: createFixtureHost({ dir: path.join(dir, 'fixtures') }),
      hostInfo: { appName: 'test', appVersion: '0', apiVersion: 1 },
    });
    try {
      await expect(runtime.call('id', '__info')).resolves.toEqual({
        baseUrl: 'https://demo.example',
        capabilities: [],
      });
    } finally {
      runtime.dispose();
    }
  });

  it('refuses an existing directory', async () => {
    const parent = await scratch();
    await createExtension(parent, { id: 'demo' });
    await expect(createExtension(parent, { id: 'demo' })).rejects.toThrow(/not empty/);
  });

  it('rejects bundles that need Node.js modules', async () => {
    const dir = await createExtension(await scratch(), { id: 'demo' });
    await writeFile(
      path.join(dir, 'src/index.ts'),
      "import { readFileSync } from 'node:fs';\nexport default { createSource: () => readFileSync };\n",
    );
    await expect(buildExtension(dir, { write: false })).rejects.toThrow(/node:fs/);
  });

  it('reports manifest problems by field', async () => {
    const dir = await createExtension(await scratch(), { id: 'demo' });
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 'one', apiVersion: 99 }));
    await expect(buildExtension(dir, { write: false })).rejects.toThrow(/version: semver/);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, apiVersion: 99 }));
    await expect(buildExtension(dir, { write: false })).rejects.toThrow(/apiVersion 99/);
  });
});

describe('RateLimiter', () => {
  it('lets `requests` through per window and spaces the rest', async () => {
    const limiter = new RateLimiter(2, 100);
    const started = Date.now();
    const times: number[] = [];
    await Promise.all([0, 1, 2, 3].map(() => limiter.acquire().then(() => times.push(Date.now() - started))));
    expect(times[1]).toBeLessThan(50);
    expect(times[2]).toBeGreaterThanOrEqual(95);
    expect(times[3]).toBeGreaterThanOrEqual(95);
  });
});
