// Host side of the extension repository format (BRAINSTORM.md §5.8): ed25519 signatures over
// `index.json`, sha256 of archives and reading an archive safely. Used by `mr-ext repo` and the app.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { type ExtensionManifest, SDK_API_VERSION, manifestSchema } from '@manga-reader/extension-sdk/manifest';
import {
  ARCHIVE_FILES,
  type ArchiveFile,
  REPO_LIMITS,
  type RepoEntry,
  type RepoIndex,
  publicKeySchema,
  repoIndexSchema,
} from '@manga-reader/extension-sdk/repo';
import yauzl from 'yauzl';

export type RepoErrorCode = 'bad-key' | 'bad-index' | 'bad-signature' | 'hash-mismatch' | 'bad-archive';

export class RepoError extends Error {
  override readonly name = 'RepoError';
  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const PUBLIC_KEY_PREFIX = 'ed25519:';
// DER prefix of an ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function rawPublicKey(key: ReturnType<typeof createPublicKey>): string {
  const der = key.export({ format: 'der', type: 'spki' });
  return PUBLIC_KEY_PREFIX + der.subarray(SPKI_PREFIX.length).toString('base64');
}

/** A new signing key: the private half as PKCS#8 PEM (keep it secret), the public half as `ed25519:…`. */
export function generateRepoKey(): { privateKeyPem: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: rawPublicKey(publicKey),
  };
}

function privateKeyOf(pem: string) {
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new RepoError('bad-key', 'The signing key is not a PEM private key');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new RepoError('bad-key', 'The signing key is not an ed25519 key');
  return key;
}

/** `ed25519:…` of a private key. */
export const publicKeyOf = (privateKeyPem: string): string =>
  rawPublicKey(createPublicKey(privateKeyOf(privateKeyPem)));

function publicKeyObject(publicKey: string) {
  if (!publicKeySchema.safeParse(publicKey).success) {
    throw new RepoError('bad-key', `Not a public key: expected ed25519:<base64 of 32 bytes>, got "${publicKey}"`);
  }
  const raw = Buffer.from(publicKey.slice(PUBLIC_KEY_PREFIX.length), 'base64');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** Normalises a key the user typed or pasted; throws `bad-key` when it is not one. */
export function parsePublicKey(text: string): string {
  const key = text.trim();
  publicKeyObject(key);
  return key;
}

/** Base64 signature over the exact bytes of `index.json` (the content of `index.json.sig`). */
export const signIndex = (indexBytes: Uint8Array, privateKeyPem: string): string =>
  sign(null, indexBytes, privateKeyOf(privateKeyPem)).toString('base64');

/** Whether `signature` (the text of `index.json.sig`) was made over `indexBytes` by `publicKey`. */
export function verifyIndexSignature(indexBytes: Uint8Array, signature: string, publicKey: string): boolean {
  const raw = Buffer.from(signature.trim(), 'base64');
  if (raw.length !== 64) return false;
  return verify(null, indexBytes, publicKeyObject(publicKey), raw);
}

/** Of `publicKeys`, the one that signed the index, if any. */
export const signerOf = (indexBytes: Uint8Array, signature: string, publicKeys: readonly string[]) =>
  publicKeys.find((key) => verifyIndexSignature(indexBytes, signature, key));

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

/** Parses and validates `index.json`. */
export function parseRepoIndex(indexBytes: Uint8Array): RepoIndex {
  if (indexBytes.byteLength > REPO_LIMITS.indexBytes) throw new RepoError('bad-index', 'index.json is too large');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(indexBytes).toString('utf8'));
  } catch {
    throw new RepoError('bad-index', 'index.json is not valid JSON');
  }
  const parsed = repoIndexSchema.safeParse(raw);
  if (!parsed.success)
    throw new RepoError('bad-index', `index.json is not a repository index: ${issuesOf(parsed.error)}`);
  return parsed.data;
}

/** Throws unless the archive's size and sha256 are the ones the index lists. */
export function checkArchiveHash(entry: RepoEntry, bytes: Uint8Array): void {
  const actual = sha256Hex(bytes);
  if (bytes.byteLength !== entry.size || actual !== entry.sha256) {
    throw new RepoError(
      'hash-mismatch',
      `${entry.file}: sha256 mismatch (index lists ${entry.sha256}, ${entry.size} bytes; got ${actual}, ${bytes.byteLength} bytes)`,
    );
  }
}

export interface ExtensionArchive {
  manifest: ExtensionManifest;
  files: Partial<Record<ArchiveFile, Buffer>> & { 'manifest.json': Buffer; 'index.js': Buffer };
}

const ENTRY_LIMITS: Record<ArchiveFile, number> = {
  'manifest.json': REPO_LIMITS.manifestBytes,
  'index.js': REPO_LIMITS.codeBytes,
  'icon.png': REPO_LIMITS.iconBytes,
};

function readZip(bytes: Uint8Array): Promise<Map<ArchiveFile, Buffer>> {
  const fail = (message: string) => new RepoError('bad-archive', message);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(fail(`not a zip archive (${error?.message ?? 'unreadable'})`));
        return;
      }
      const files = new Map<ArchiveFile, Buffer>();
      const stop = (e: unknown) => {
        zip.close();
        reject(e instanceof RepoError ? e : fail(e instanceof Error ? e.message : String(e)));
      };
      zip.on('error', stop);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName as ArchiveFile;
        // Flat, known files only: no folders, no paths, nothing to extract outside the target.
        if (!ARCHIVE_FILES.includes(name)) {
          stop(fail(`unexpected file "${entry.fileName}" (allowed: ${ARCHIVE_FILES.join(', ')})`));
          return;
        }
        if (files.has(name)) {
          stop(fail(`"${name}" appears twice`));
          return;
        }
        if (entry.uncompressedSize > ENTRY_LIMITS[name]) {
          stop(fail(`"${name}" is too large`));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            stop(streamError ?? fail(`cannot read "${name}"`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', stop);
          stream.on('end', () => {
            files.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Reads an extension archive in memory and validates it: only `manifest.json`, `index.js` and an
 * optional `icon.png` at the root, a valid manifest this host can run, and (with `expected`) the
 * id, version and permissions the repository index promised.
 */
export async function readExtensionArchive(bytes: Uint8Array, expected?: RepoEntry): Promise<ExtensionArchive> {
  const fail = (message: string) => new RepoError('bad-archive', expected ? `${expected.file}: ${message}` : message);
  if (bytes.byteLength > REPO_LIMITS.archiveBytes) throw fail('archive is too large');
  let files: Map<ArchiveFile, Buffer>;
  try {
    files = await readZip(bytes);
  } catch (error) {
    throw fail((error as Error).message);
  }
  const manifestBytes = files.get('manifest.json');
  const code = files.get('index.js');
  if (!manifestBytes || !code) throw fail('manifest.json and index.js are required');

  let raw: unknown;
  try {
    raw = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw fail('manifest.json is not valid JSON');
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw fail(`invalid manifest.json: ${issuesOf(parsed.error)}`);
  const manifest = parsed.data;
  if (manifest.apiVersion > SDK_API_VERSION) {
    throw fail(`needs extension API ${manifest.apiVersion}, this app supports ${SDK_API_VERSION}`);
  }
  if (expected) {
    const listed = entryFields(manifest);
    for (const key of ['id', 'version', 'apiVersion', 'nsfw', 'langs', 'domains'] as const) {
      if (JSON.stringify(listed[key]) !== JSON.stringify(expected[key])) {
        throw fail(
          `manifest ${key} ${JSON.stringify(listed[key])} differs from the index (${JSON.stringify(expected[key])})`,
        );
      }
    }
  }
  return {
    manifest,
    files: { ...Object.fromEntries(files), 'manifest.json': manifestBytes, 'index.js': code },
  };
}

/** The index fields that come straight from a manifest. */
export function entryFields(manifest: ExtensionManifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    ...(manifest.description ? { description: manifest.description } : {}),
    nsfw: manifest.nsfw,
    langs: [...new Set(manifest.sources.map((s) => s.lang))].sort(),
    domains: manifest.domains,
  };
}
