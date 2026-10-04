// Host/tooling only: the extension repository format (docs/BRAINSTORM.md §5.8), shared by `mr-ext repo`
// and the app. Imported via `@matane/extension-sdk/repo`.
import { z } from 'zod';
import { extensionIdSchema, manifestSchema } from './manifest.js';

export const REPO_FORMAT_VERSION = 1;
export const REPO_INDEX_FILE = 'index.json';
/** Base64 ed25519 signature over the exact bytes of `index.json`. */
export const REPO_SIGNATURE_FILE = 'index.json.sig';

/** The only files an extension archive may hold, all at its root. */
export const ARCHIVE_FILES = ['manifest.json', 'index.js', 'icon.png'] as const;
export type ArchiveFile = (typeof ARCHIVE_FILES)[number];

/** Upper bounds shared by the builder, `verify` and the app's installer. */
export const REPO_LIMITS = {
  indexBytes: 2 * 1024 * 1024,
  archiveBytes: 20 * 1024 * 1024,
  iconBytes: 512 * 1024,
  manifestBytes: 64 * 1024,
  codeBytes: 10 * 1024 * 1024,
} as const;

/** `ed25519:` + base64 of the raw 32-byte public key. */
export const publicKeySchema = z.string().regex(/^ed25519:[A-Za-z0-9+/]{43}=$/, 'ed25519:<base64 of 32 bytes>');

export const archivePath = (id: string, version: string): string => `extensions/${id}-${version}.zip`;
export const iconPath = (id: string): string => `extensions/icons/${id}.png`;

const version = manifestSchema.shape.version;

export const repoEntrySchema = z
  .object({
    id: extensionIdSchema,
    name: z.string().min(1),
    version,
    apiVersion: z.number().int().positive(),
    description: z.string().max(200).optional(),
    nsfw: z.boolean(),
    /** Languages of the extension's sources, sorted and unique. */
    langs: z.array(z.string().min(2)).min(1),
    /** Relative to the repo root; always `archivePath(id, version)`. */
    file: z.string(),
    size: z.number().int().positive().max(REPO_LIMITS.archiveBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex sha256'),
    /** Relative to the repo root; always `iconPath(id)` when present. */
    icon: z.string().nullable(),
  })
  .superRefine((entry, ctx) => {
    // Fixed paths: nothing in an index can point outside the repo or at another extension's files.
    if (entry.file !== archivePath(entry.id, entry.version)) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: `must be ${archivePath(entry.id, entry.version)}` });
    }
    if (entry.icon !== null && entry.icon !== iconPath(entry.id)) {
      ctx.addIssue({ code: 'custom', path: ['icon'], message: `must be ${iconPath(entry.id)} or null` });
    }
  });
export type RepoEntry = z.infer<typeof repoEntrySchema>;

export const repoIndexSchema = z
  .object({
    formatVersion: z.literal(REPO_FORMAT_VERSION),
    name: z.string().min(1).max(100),
    /** Informative only: trust comes from keys the app knows, never from the index itself. */
    publicKey: publicKeySchema.optional(),
    extensions: z.array(repoEntrySchema),
  })
  .superRefine((index, ctx) => {
    const seen = new Set<string>();
    index.extensions.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: ['extensions', i, 'id'], message: `duplicate id "${entry.id}"` });
      }
      seen.add(entry.id);
    });
  });
export type RepoIndex = z.infer<typeof repoIndexSchema>;
