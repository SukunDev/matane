import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRepo } from '@manga-reader/extension-cli';
import { generateRepoKey, signIndex } from '@manga-reader/extension-runtime/repo';
import { AppError } from '@manga-reader/shared/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ExtensionsRepository } from '../db/repositories/extensions';
import { ReposRepository } from '../db/repositories/repos';
import type { FetchBytes } from '../network/fetch-bytes';
import { ExtensionInstaller } from './installer';
import { ExtensionRegistry } from './registry';
import { RepoService, evaluateTrust, normalizeRepoUrl } from './repos';
import { ExtensionService } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const REPO_URL = 'https://repo.test/ext/';
const OTHER_URL = 'https://other.test/';

const official = generateRepoKey();
const community = generateRepoKey();

let dir: string;
let connection: DatabaseConnection;
/** URL prefix → folder served by the fake network. */
let served: Map<string, string>;
let fetched: string[];
let repos: RepoService;
let installer: ExtensionInstaller;
let extensions: ExtensionService;
let extensionsRepo: ExtensionsRepository;
let clearedSessions: string[];
let unloaded: string[];

function writeExtension(folder: string, version: string, domains = ['demo.example'], extra: object = {}) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'manifest.json'),
    JSON.stringify({
      id: 'demo',
      name: 'Demo',
      version,
      apiVersion: 1,
      domains,
      sources: [{ key: 'en', lang: 'en', name: 'Demo' }],
      ...extra,
    }),
  );
  writeFileSync(join(folder, 'index.js'), `globalThis.__extension = { createSource: () => ({ v: '${version}' }) };`);
}

/** Publishes a repository with "demo" at `version` into a served folder. */
async function publish(
  url: string,
  version: string,
  key: { privateKeyPem: string } | null,
  domains?: string[],
): Promise<string> {
  const source = join(dir, `src-${version}-${Math.random()}`);
  writeExtension(source, version, domains);
  writeFileSync(join(source, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const out = served.get(url) ?? join(dir, `repo-${served.size}`);
  served.set(url, out);
  await buildRepo({ extensions: [source], outDir: out, name: `Repo ${url}`, privateKeyPem: key?.privateKeyPem });
  return out;
}

const fetchBytes: FetchBytes = async (url, { maxBytes }) => {
  fetched.push(url);
  for (const [prefix, folder] of served) {
    if (!url.startsWith(prefix)) continue;
    const file = join(folder, url.slice(prefix.length));
    if (!existsSync(file)) return null;
    const bytes = readFileSync(file);
    if (bytes.byteLength > maxBytes) throw new AppError('repo', 'too large');
    return bytes;
  }
  throw new AppError('network', `${url}: unreachable`);
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-repos-'));
  served = new Map();
  fetched = [];
  clearedSessions = [];
  unloaded = [];
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  const changes = new DbChanges(() => undefined);
  extensionsRepo = new ExtensionsRepository(connection.db, changes);
  const reposRepo = new ReposRepository(connection.db, changes);
  mkdirSync(join(dir, 'builtin'));
  const registry = new ExtensionRegistry({
    builtinDir: join(dir, 'builtin'),
    installedDir: join(dir, 'installed'),
    devFolders: () => [],
  });
  extensions = new ExtensionService({
    registry,
    repo: extensionsRepo,
    host: {
      request: (async (_method: string, params: { extensionId: string }) => {
        unloaded.push(params.extensionId);
      }) as never,
    },
    network: { request: async () => ({}) as never, invalidate: () => undefined, isSolving: () => false },
    devFolders: { get: () => [], set: () => undefined },
    log: () => undefined,
  });
  await extensions.init();
  repos = new RepoService({
    repo: reposRepo,
    fetchBytes,
    officialKeys: () => [official.publicKey],
    isOnline: () => true,
  });
  installer = new ExtensionInstaller({
    dir: join(dir, 'installed'),
    repos,
    fetchBytes,
    extensions,
    origin: { get: (id) => reposRepo.installedFrom(id), set: (id, repoId) => reposRepo.setInstalledFrom(id, repoId) },
    forget: (id) => extensionsRepo.remove(id),
    clearSession: async (id) => {
      clearedSessions.push(id);
    },
  });
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const addOfficial = async () => {
  await publish(REPO_URL, '1.0.0', official);
  const result = await repos.add(REPO_URL);
  if (result.status !== 'added') throw new Error('not added');
  return result.repo;
};

describe('normalizeRepoUrl', () => {
  it.each([
    ['repo.example/ext', 'https://repo.example/ext/'],
    ['https://repo.example/ext/index.json?x=1#y', 'https://repo.example/ext/'],
    ['http://127.0.0.1:8080/repo', 'http://127.0.0.1:8080/repo/'],
    ['http://e2e.localhost:9/repo/', 'http://e2e.localhost:9/repo/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRepoUrl(input)).toBe(expected);
  });

  it.each(['http://repo.example/', 'ftp://repo.example/', 'https://user:pw@repo.example/', 'https://'])(
    'refuses %s',
    (input) => {
      expect(() => normalizeRepoUrl(input)).toThrow(AppError);
    },
  );
});

describe('evaluateTrust', () => {
  const bytes = Buffer.from('{"index":1}');
  const keys = { official: [official.publicKey], trusted: null, named: undefined };

  it('tells official, trusted, unknown, unsigned and forged apart', () => {
    expect(evaluateTrust(bytes, signIndex(bytes, official.privateKeyPem), keys)).toEqual({
      trust: 'official',
      problem: null,
      signedBy: official.publicKey,
    });
    const byCommunity = signIndex(bytes, community.privateKeyPem);
    expect(evaluateTrust(bytes, byCommunity, { ...keys, trusted: community.publicKey }).trust).toBe('trusted');
    expect(evaluateTrust(bytes, byCommunity, { ...keys, named: community.publicKey })).toEqual({
      trust: 'unverified',
      problem: 'unknown-key',
      signedBy: community.publicKey,
    });
    expect(evaluateTrust(bytes, null, keys).problem).toBe('unsigned');
    // The index names the official key, but someone else signed it.
    expect(evaluateTrust(bytes, byCommunity, { ...keys, named: official.publicKey }).problem).toBe('bad-signature');
    expect(evaluateTrust(bytes, 'garbage', keys).problem).toBe('bad-signature');
  });
});

describe('RepoService', () => {
  it('adds an official repository right away', async () => {
    const repo = await addOfficial();
    expect(repo).toMatchObject({ url: REPO_URL, name: `Repo ${REPO_URL}`, trust: 'official', extensionCount: 1 });
    expect(repos.index(repo.id)?.extensions[0]?.version).toBe('1.0.0');
    await expect(repos.add(`${REPO_URL}index.json`)).rejects.toThrow(/already added/);
  });

  it('asks before adding an unverified repository, and can trust its key later', async () => {
    await publish(OTHER_URL, '1.0.0', community);
    const asked = await repos.add(OTHER_URL);
    expect(asked).toEqual({
      status: 'needs-confirmation',
      name: `Repo ${OTHER_URL}`,
      extensionCount: 1,
      problem: 'unknown-key',
    });
    expect(repos.list()).toEqual([]);

    const added = await repos.add(OTHER_URL, true);
    if (added.status !== 'added') throw new Error('not added');
    expect(added.repo).toMatchObject({ trust: 'unverified', problem: 'unknown-key', signedBy: community.publicKey });
    expect(repos.trustKey(added.repo.id)).toMatchObject({ trust: 'trusted', problem: null });
  });

  it('cannot trust a key when nothing is validly signed', async () => {
    await publish(OTHER_URL, '1.0.0', null);
    const added = await repos.add(OTHER_URL, true);
    if (added.status !== 'added') throw new Error('not added');
    expect(added.repo.problem).toBe('unsigned');
    expect(() => repos.trustKey(added.repo.id)).toThrow(/no valid signature/);
  });

  it('syncs a new index, but keeps the old one when a signed repository loses its signature', async () => {
    const repo = await addOfficial();
    await publish(REPO_URL, '1.1.0', official);
    await repos.sync(repo.id);
    expect(repos.index(repo.id)?.extensions[0]?.version).toBe('1.1.0');

    // Tampered: the index changes after signing.
    const folder = served.get(REPO_URL)!;
    const indexFile = join(folder, 'index.json');
    writeFileSync(indexFile, readFileSync(indexFile, 'utf8').replace('"nsfw": false', '"nsfw": true'));
    const [info] = await repos.sync(repo.id);
    expect(info).toMatchObject({ trust: 'official', lastError: expect.stringMatching(/previous one is kept/) });
    expect(repos.index(repo.id)?.extensions[0]?.version).toBe('1.1.0');

    // Re-signed by a different key: refused the same way.
    await publish(REPO_URL, '1.3.0', community);
    expect((await repos.sync(repo.id))[0]?.lastError).toMatch(/previous one is kept/);

    // Fixed: the error goes away.
    await publish(REPO_URL, '1.3.0', official);
    expect((await repos.sync(repo.id))[0]).toMatchObject({ lastError: null, trust: 'official' });
  });

  it('records a failed sync without losing the index', async () => {
    const repo = await addOfficial();
    served.clear();
    const [info] = await repos.sync(repo.id);
    expect(info?.lastError).toMatch(/unreachable/);
    expect(info?.extensionCount).toBe(1);
  });
});

describe('ExtensionInstaller', () => {
  it('installs after preparing, lists it with its repository, and loads it', async () => {
    const repo = await addOfficial();
    expect(installer.available()).toEqual([
      expect.objectContaining({
        id: 'demo',
        repoId: repo.id,
        trust: 'official',
        installedVersion: null,
        update: false,
      }),
    ]);

    const preview = await installer.prepare(repo.id, 'demo');
    expect(preview).toMatchObject({
      id: 'demo',
      version: '1.0.0',
      domains: ['demo.example'],
      newDomains: [],
      currentVersion: null,
      hasIcon: true,
    });
    // Nothing is installed before the user confirms.
    expect(existsSync(join(dir, 'installed', 'demo'))).toBe(false);

    const entry = await installer.install(preview.token);
    expect(entry).toMatchObject({ id: 'demo', origin: 'repo', version: '1.0.0', repoId: repo.id, hasIcon: true });
    expect(readdirSync(join(dir, 'installed'))).toEqual(['demo']);
    expect(readdirSync(join(dir, 'installed', 'demo')).sort()).toEqual(['icon.png', 'index.js', 'manifest.json']);
    expect(extensions.get('demo')?.code).toContain("v: '1.0.0'");
    await expect(installer.install(preview.token)).rejects.toThrow(/expired/);
  });

  it('updates from the same repository and asks again for new domains', async () => {
    const repo = await addOfficial();
    await installer.install((await installer.prepare(repo.id, 'demo')).token);

    await publish(REPO_URL, '1.1.0', official);
    await repos.sync(repo.id);
    expect(installer.available()[0]).toMatchObject({ installedVersion: '1.0.0', installedHere: true, update: true });
    expect(await installer.updateAll()).toEqual({ updated: ['demo'], needsConfirmation: [], failed: [] });
    expect(extensions.get('demo')?.manifest?.version).toBe('1.1.0');
    expect(unloaded).toContain('demo');

    await publish(REPO_URL, '1.2.0', official, ['demo.example', 'cdn.demo.example']);
    await repos.sync(repo.id);
    const result = await installer.updateAll();
    expect(result.updated).toEqual([]);
    expect(result.needsConfirmation).toEqual([
      expect.objectContaining({
        id: 'demo',
        version: '1.2.0',
        currentVersion: '1.1.0',
        newDomains: ['cdn.demo.example'],
      }),
    ]);
    expect(extensions.get('demo')?.manifest?.version).toBe('1.1.0');
    await installer.install(result.needsConfirmation[0]!.token);
    expect(extensions.get('demo')?.manifest?.domains).toEqual(['demo.example', 'cdn.demo.example']);
  });

  it('never takes an installed extension from another repository', async () => {
    const repo = await addOfficial();
    await installer.install((await installer.prepare(repo.id, 'demo')).token);
    await publish(OTHER_URL, '9.0.0', community);
    const other = await repos.add(OTHER_URL, true);
    if (other.status !== 'added') throw new Error('not added');
    expect(installer.available().find((a) => a.repoId === other.repo.id)).toMatchObject({
      installedVersion: '1.0.0',
      installedHere: false,
      update: false,
    });
    await expect(installer.prepare(other.repo.id, 'demo')).rejects.toThrow(/another repository/);
  });

  it('refuses an archive that does not match the signed index', async () => {
    const repo = await addOfficial();
    const zip = join(served.get(REPO_URL)!, 'extensions', 'demo-1.0.0.zip');
    const bytes = readFileSync(zip);
    bytes[bytes.length - 50]! ^= 1;
    writeFileSync(zip, bytes);
    await expect(installer.prepare(repo.id, 'demo')).rejects.toThrow(/sha256 mismatch/);
    expect(existsSync(join(dir, 'installed'))).toBe(false);
  });

  it('uninstalls with storage, preferences and session; sources stay', async () => {
    const repo = await addOfficial();
    await installer.install((await installer.prepare(repo.id, 'demo')).token);
    extensionsRepo.setStorage('demo', 'token', 'abc');
    extensionsRepo.setPref('demo', 'hd', true);

    await installer.uninstall('demo');
    expect(existsSync(join(dir, 'installed', 'demo'))).toBe(false);
    expect(extensions.get('demo')).toBeUndefined();
    expect(extensionsRepo.get('demo')).toBeUndefined();
    expect(extensionsRepo.getStorage('demo', 'token')).toBeNull();
    expect(extensionsRepo.getPrefs('demo')).toEqual({});
    expect(clearedSessions).toEqual(['demo']);
    expect(extensionsRepo.getSource('demo/en')).toMatchObject({ extensionId: 'demo' });
    await expect(installer.uninstall('demo')).rejects.toThrow(/not installed/);

    // Installing again brings it back.
    await installer.install((await installer.prepare(repo.id, 'demo')).token);
    expect(extensions.isInstalled('demo')).toBe(true);
  });

  it('falls back to a built-in with the same id after an uninstall', async () => {
    writeExtension(join(dir, 'builtin', 'demo'), '0.9.0');
    await extensions.reload();
    const repo = await addOfficial();
    await installer.install((await installer.prepare(repo.id, 'demo')).token);
    expect(extensions.list()[0]).toMatchObject({ origin: 'repo', version: '1.0.0' });
    await installer.uninstall('demo');
    expect(extensions.list()[0]).toMatchObject({ origin: 'builtin', version: '0.9.0', repoId: null });
  });

  it('recovers from an install interrupted before or after the swap', async () => {
    const installed = join(dir, 'installed');
    writeExtension(join(installed, 'demo.old'), '1.0.0');
    writeExtension(join(installed, 'other.tmp'), '2.0.0');
    writeExtension(join(installed, 'kept'), '1.0.0');
    writeExtension(join(installed, 'kept.old'), '0.1.0');
    await installer.recover();
    expect(readdirSync(installed).sort()).toEqual(['demo', 'kept']);
  });
});
