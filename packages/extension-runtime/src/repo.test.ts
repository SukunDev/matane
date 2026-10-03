import { archivePath, iconPath, type RepoEntry } from '@matane/extension-sdk/repo';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  RepoError,
  checkArchiveHash,
  entryFields,
  generateRepoKey,
  parsePublicKey,
  parseRepoIndex,
  publicKeyOf,
  readExtensionArchive,
  sha256Hex,
  signIndex,
  signerOf,
  verifyIndexSignature,
} from './repo.js';

const manifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.2.0',
  apiVersion: 1,
  nsfw: false,
  sources: [
    { key: 'id', lang: 'id', name: 'Demo' },
    { key: 'en', lang: 'en', name: 'Demo' },
  ],
};

function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith('/')) zip.addEmptyDirectory(name);
    else zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const goodZip = (patch: object = {}) =>
  zipOf({ 'manifest.json': JSON.stringify({ ...manifest, ...patch }), 'index.js': 'globalThis.__extension = {};' });

async function entryFor(zip: Buffer): Promise<RepoEntry> {
  const parsed = await readExtensionArchive(zip);
  return {
    ...entryFields(parsed.manifest),
    file: archivePath('demo', '1.2.0'),
    size: zip.byteLength,
    sha256: sha256Hex(zip),
    icon: null,
  };
}

describe('signing', () => {
  const key = generateRepoKey();
  const index = Buffer.from('{"formatVersion":1}\n');

  it('verifies what the key signed, and nothing else', () => {
    expect(key.publicKey).toMatch(/^ed25519:[A-Za-z0-9+/]{43}=$/);
    expect(publicKeyOf(key.privateKeyPem)).toBe(key.publicKey);
    const signature = signIndex(index, key.privateKeyPem);
    expect(verifyIndexSignature(index, `${signature}\n`, key.publicKey)).toBe(true);

    const tampered = Buffer.from(index);
    tampered[3]! ^= 1;
    expect(verifyIndexSignature(tampered, signature, key.publicKey)).toBe(false);
    expect(verifyIndexSignature(index, signature, generateRepoKey().publicKey)).toBe(false);
    expect(verifyIndexSignature(index, 'not a signature', key.publicKey)).toBe(false);
  });

  it('finds the signer among known keys', () => {
    const other = generateRepoKey();
    const signature = signIndex(index, key.privateKeyPem);
    expect(signerOf(index, signature, [other.publicKey, key.publicKey])).toBe(key.publicKey);
    expect(signerOf(index, signature, [other.publicKey])).toBeUndefined();
  });

  it('refuses keys that are not ed25519', () => {
    expect(() => parsePublicKey('ed25519:abc')).toThrow(RepoError);
    expect(() => parsePublicKey('rsa:AAAA')).toThrow(/ed25519:/);
    expect(parsePublicKey(`  ${key.publicKey}\n`)).toBe(key.publicKey);
    expect(() => signIndex(index, 'not a pem')).toThrow(/PEM/);
  });
});

describe('parseRepoIndex', () => {
  const entry = {
    ...entryFields(manifest),
    file: archivePath('demo', '1.2.0'),
    size: 10,
    sha256: 'a'.repeat(64),
    icon: iconPath('demo'),
  };
  const bytes = (index: object) => Buffer.from(JSON.stringify(index));

  it('accepts a valid index', () => {
    const index = parseRepoIndex(bytes({ formatVersion: 1, name: 'Repo', extensions: [entry] }));
    expect(index.extensions[0]?.langs).toEqual(['en', 'id']);
  });

  it.each([
    ['not JSON', Buffer.from('{')],
    ['another format version', bytes({ formatVersion: 2, name: 'Repo', extensions: [] })],
    ['a path outside the repo', bytes({ formatVersion: 1, name: 'R', extensions: [{ ...entry, file: '../x.zip' }] })],
    [
      'an icon of another extension',
      bytes({ formatVersion: 1, name: 'R', extensions: [{ ...entry, icon: iconPath('x') }] }),
    ],
    ['a duplicate id', bytes({ formatVersion: 1, name: 'R', extensions: [entry, entry] })],
    ['a bad hash', bytes({ formatVersion: 1, name: 'R', extensions: [{ ...entry, sha256: 'XYZ' }] })],
  ])('rejects %s', (_, input) => {
    expect(() => parseRepoIndex(input)).toThrow(RepoError);
  });
});

describe('archives', () => {
  it('reads a valid archive and matches it against its index entry', async () => {
    const zip = await goodZip();
    const entry = await entryFor(zip);
    checkArchiveHash(entry, zip);
    const archive = await readExtensionArchive(zip, entry);
    expect(archive.manifest.id).toBe('demo');
    expect(archive.files['index.js'].toString()).toContain('__extension');
  });

  it('refuses an archive whose bytes differ from the index', async () => {
    const zip = await goodZip();
    const entry = await entryFor(zip);
    const changed = Buffer.from(zip);
    changed[changed.length - 30]! ^= 1;
    expect(() => checkArchiveHash(entry, changed)).toThrow(/sha256 mismatch/);
  });

  it.each([
    [
      'a nested path',
      { 'manifest.json': JSON.stringify(manifest), 'index.js': '', 'lib/extra.js': 'x' },
      /unexpected file/,
    ],
    ['a folder', { 'manifest.json': JSON.stringify(manifest), 'index.js': '', 'lib/': '' }, /unexpected file/],
    ['an extra file', { 'manifest.json': JSON.stringify(manifest), 'index.js': '', 'run.sh': 'x' }, /unexpected file/],
    ['no code', { 'manifest.json': JSON.stringify(manifest) }, /required/],
    ['a broken manifest', { 'manifest.json': '{"id":1}', 'index.js': '' }, /invalid manifest/],
    ['a newer API', { 'manifest.json': JSON.stringify({ ...manifest, apiVersion: 99 }), 'index.js': '' }, /API 99/],
  ])('rejects %s', async (_, files, message) => {
    await expect(readExtensionArchive(await zipOf(files))).rejects.toThrow(message);
  });

  it('rejects a zip-slip name even if the zip library would allow it', async () => {
    // yazl refuses "../" itself, so rename the entry in place (same length).
    const zip = await zipOf({ 'manifest.json': JSON.stringify(manifest), 'index.js': '', 'xxxevil.js': 'x' });
    const patched = Buffer.from(zip.toString('latin1').replaceAll('xxxevil.js', '../evil.js'), 'latin1');
    await expect(readExtensionArchive(patched)).rejects.toThrow(RepoError);
  });

  it('rejects a manifest that differs from what the index promised', async () => {
    const entry = await entryFor(await goodZip());
    await expect(readExtensionArchive(await goodZip({ nsfw: true }), entry)).rejects.toThrow(
      /manifest nsfw .* differs from the index/,
    );
    await expect(readExtensionArchive(await goodZip({ version: '1.3.0' }), entry)).rejects.toThrow(/version/);
  });

  it('rejects something that is not a zip', async () => {
    await expect(readExtensionArchive(Buffer.from('hello'))).rejects.toThrow(/not a zip/);
  });
});
