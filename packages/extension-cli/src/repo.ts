import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';
import {
  REPO_FORMAT_VERSION,
  REPO_INDEX_FILE,
  REPO_LIMITS,
  REPO_SIGNATURE_FILE,
  type RepoEntry,
  type RepoIndex,
  archivePath,
  iconPath,
} from '@manga-reader/extension-sdk/repo';
import {
  RepoError,
  checkArchiveHash,
  entryFields,
  generateRepoKey,
  parseRepoIndex,
  publicKeyOf,
  readExtensionArchive,
  sha256Hex,
  signIndex,
  verifyIndexSignature,
} from '@manga-reader/extension-runtime/repo';
import yazl from 'yazl';
import { buildExtension, readManifest } from './build';

/** Env var holding the PEM private key in CI (a secret), instead of `--key <file>`. */
export const KEY_ENV = 'MR_REPO_KEY';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Writes a new private key (mode 600, never over an existing file) and returns its public key. */
export async function repoKeygen(out: string): Promise<string> {
  if (await exists(out)) throw new Error(`${out} already exists; refusing to overwrite a key`);
  const { privateKeyPem, publicKey } = generateRepoKey();
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, privateKeyPem, { mode: 0o600, flag: 'wx' });
  return publicKey;
}

// Local midnight 1980-01-01 is DOS time zero in every time zone; with no extended timestamp and
// stored entries, the same files always give the same bytes.
const ZIP_DATE = new Date(1980, 0, 1);

/** A reproducible zip of the given root-level files (in the order given). */
export function deterministicZip(files: [name: string, bytes: Buffer][]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of files) {
    zip.addBuffer(bytes, name, { mtime: ZIP_DATE, mode: 0o100644, compress: false, forceDosTimestamp: true });
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

interface BuiltExtension {
  manifest: ExtensionManifest;
  code: Buffer;
  icon: Buffer | null;
}

/**
 * An extension folder: sources (`src/index.ts`, built and minified here) or an already built one
 * (`manifest.json` + `index.js`, e.g. a `dist/`). `icon.png` is taken from the folder when present.
 */
async function loadExtension(dir: string): Promise<BuiltExtension> {
  const root = path.resolve(dir);
  const icon = await readFile(path.join(root, 'icon.png')).catch(() => null);
  if (icon && icon.byteLength > REPO_LIMITS.iconBytes) throw new Error(`${dir}: icon.png is larger than 512 KB`);
  if (await exists(path.join(root, 'src/index.ts'))) {
    const result = await buildExtension(root, { minify: true, write: false });
    return { manifest: result.manifest, code: Buffer.from(result.code), icon };
  }
  if (await exists(path.join(root, 'index.js'))) {
    return { manifest: await readManifest(root), code: await readFile(path.join(root, 'index.js')), icon };
  }
  throw new Error(`${dir}: neither src/index.ts nor a built index.js`);
}

export interface BuildRepoOptions {
  extensions: string[];
  outDir: string;
  name: string;
  /** PKCS#8 PEM; without it the repo is written unsigned (and apps will call it unverified). */
  privateKeyPem?: string;
}

export interface BuildRepoResult {
  index: RepoIndex;
  signed: boolean;
}

/**
 * Builds a repository folder ready for static hosting (BRAINSTORM.md §5.8): one reproducible zip
 * per extension, icons, `index.json` sorted by id, and `index.json.sig` when a key is given.
 */
export async function buildRepo(options: BuildRepoOptions): Promise<BuildRepoResult> {
  const outDir = path.resolve(options.outDir);
  const existing = await readdir(outDir).catch((): string[] => []);
  if (existing.length > 0 && !existing.includes(REPO_INDEX_FILE)) {
    throw new Error(`${options.outDir} is not empty and not a repository; refusing to write into it`);
  }

  const built = await Promise.all(options.extensions.map(loadExtension));
  built.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
  for (let i = 1; i < built.length; i++) {
    if (built[i]!.manifest.id === built[i - 1]!.manifest.id) {
      throw new Error(`Extension id "${built[i]!.manifest.id}" is given twice`);
    }
  }

  // A rebuilt repo replaces the previous output completely.
  await rm(path.join(outDir, 'extensions'), { recursive: true, force: true });
  await rm(path.join(outDir, REPO_SIGNATURE_FILE), { force: true });
  await mkdir(path.join(outDir, 'extensions'), { recursive: true });

  const entries: RepoEntry[] = [];
  for (const { manifest, code, icon } of built) {
    const files: [string, Buffer][] = [
      ['manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
      ['index.js', code],
    ];
    if (icon) files.push(['icon.png', icon]);
    const zip = await deterministicZip(files);
    if (zip.byteLength > REPO_LIMITS.archiveBytes) throw new Error(`${manifest.id}: archive is larger than 20 MB`);
    const file = archivePath(manifest.id, manifest.version);
    await writeFile(path.join(outDir, file), zip);
    if (icon) {
      await mkdir(path.join(outDir, 'extensions/icons'), { recursive: true });
      await writeFile(path.join(outDir, iconPath(manifest.id)), icon);
    }
    entries.push({
      ...entryFields(manifest),
      file,
      size: zip.byteLength,
      sha256: sha256Hex(zip),
      icon: icon ? iconPath(manifest.id) : null,
    });
  }

  const index: RepoIndex = {
    formatVersion: REPO_FORMAT_VERSION,
    name: options.name,
    ...(options.privateKeyPem ? { publicKey: publicKeyOf(options.privateKeyPem) } : {}),
    extensions: entries,
  };
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  // What is written must be what the app accepts.
  parseRepoIndex(indexBytes);
  await writeFile(path.join(outDir, REPO_INDEX_FILE), indexBytes);
  if (options.privateKeyPem) {
    await writeFile(path.join(outDir, REPO_SIGNATURE_FILE), `${signIndex(indexBytes, options.privateKeyPem)}\n`);
  }
  return { index, signed: Boolean(options.privateKeyPem) };
}

export interface VerifyRepoOptions {
  /** A repository folder or its base URL. */
  source: string;
  /** The key the repo must be signed with. Without it, the key in the index is used (not a trust check). */
  publicKey?: string;
  fetchBytes?: (url: string) => Promise<Buffer | null>;
}

export interface VerifyRepoResult {
  index: RepoIndex | null;
  /** The key the signature was checked against, and whether it matched. */
  signature: { key: string | null; valid: boolean; trusted: boolean };
  problems: string[];
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function reader(options: VerifyRepoOptions): (file: string) => Promise<Buffer | null> {
  if (/^https?:\/\//.test(options.source)) {
    const base = options.source.endsWith('/') ? options.source : `${options.source}/`;
    const get = options.fetchBytes ?? fetchBytes;
    return (file) => get(new URL(file, base).toString());
  }
  return (file) => readFile(path.join(options.source, file)).catch(() => null);
}

/**
 * Checks a repository the way the app will: the signature over `index.json`, the index format,
 * and for every extension its archive's size and sha256, contents and manifest.
 */
export async function verifyRepo(options: VerifyRepoOptions): Promise<VerifyRepoResult> {
  const read = reader(options);
  const problems: string[] = [];
  const result: VerifyRepoResult = { index: null, signature: { key: null, valid: false, trusted: false }, problems };

  const indexBytes = await read(REPO_INDEX_FILE);
  if (!indexBytes) {
    problems.push(`${REPO_INDEX_FILE} is missing`);
    return result;
  }
  try {
    result.index = parseRepoIndex(indexBytes);
  } catch (error) {
    problems.push((error as Error).message);
  }

  const key = options.publicKey ?? result.index?.publicKey ?? null;
  result.signature = { key, valid: false, trusted: Boolean(options.publicKey) };
  const signature = (await read(REPO_SIGNATURE_FILE))?.toString('utf8');
  if (!signature) {
    problems.push(`${REPO_SIGNATURE_FILE} is missing: the repository is unsigned`);
  } else if (!key) {
    problems.push('No public key to check the signature with (pass --public-key)');
  } else {
    try {
      result.signature.valid = verifyIndexSignature(indexBytes, signature, key);
      if (!result.signature.valid) {
        problems.push(
          `${REPO_SIGNATURE_FILE} does not match ${REPO_INDEX_FILE} for ${key}: the index changed after signing, or another key signed it`,
        );
      }
    } catch (error) {
      problems.push(error instanceof RepoError ? error.message : String(error));
    }
  }

  for (const entry of result.index?.extensions ?? []) {
    const zip = await read(entry.file);
    if (!zip) {
      problems.push(`${entry.file} is missing`);
      continue;
    }
    try {
      checkArchiveHash(entry, zip);
      await readExtensionArchive(zip, entry);
    } catch (error) {
      problems.push((error as Error).message);
    }
    if (entry.icon && !(await read(entry.icon))) problems.push(`${entry.icon} is missing`);
  }
  return result;
}

/** The private key from `--key <file>` or `$MR_REPO_KEY`. */
export async function loadPrivateKey(file: string | undefined): Promise<string | undefined> {
  if (file) return readFile(file, 'utf8');
  return process.env[KEY_ENV] || undefined;
}
