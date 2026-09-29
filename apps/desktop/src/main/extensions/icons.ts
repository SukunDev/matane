import { readFile } from 'node:fs/promises';
import { REPO_LIMITS } from '@matane/extension-sdk/repo';
import { AppError } from '@manga-reader/shared/errors';
import type { ServedImage } from '../images/service';
import type { FetchBytes } from '../network/fetch-bytes';
import type { RepoService } from './repos';

const REPO_ICON_TTL_MS = 24 * 3_600_000;
const PNG = [0x89, 0x50, 0x4e, 0x47];

const isPng = (bytes: Uint8Array) => PNG.every((b, i) => bytes[i] === b);

export interface ExtensionIconsDeps {
  /** `icon.png` of an installed extension. */
  installedIcon: (extensionId: string) => string | null;
  repos: Pick<RepoService, 'index' | 'fileUrl'>;
  fetchBytes: FetchBytes;
  now?: () => number;
}

/**
 * Extension icons for `manga://extension-icon/<id>` (installed) and `manga://repo-icon/<repoId>/<id>`
 * (offered by a repository; fetched once a day and kept in memory). Only PNGs are served.
 */
export class ExtensionIcons {
  private readonly cache = new Map<string, { data: Buffer; at: number }>();

  constructor(private readonly deps: ExtensionIconsDeps) {}

  async installed(extensionId: string): Promise<ServedImage> {
    const path = this.deps.installedIcon(extensionId);
    if (!path) throw new AppError('not_found', `${extensionId} has no icon`);
    return this.serve(await readFile(path));
  }

  async repo(repoId: number, extensionId: string): Promise<ServedImage> {
    const key = `${repoId}/${extensionId}`;
    const now = this.deps.now?.() ?? Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.at < REPO_ICON_TTL_MS) return this.serve(cached.data);
    const entry = this.deps.repos.index(repoId)?.extensions.find((e) => e.id === extensionId);
    if (!entry?.icon) throw new AppError('not_found', `${extensionId} has no icon`);
    const data = await this.deps.fetchBytes(this.deps.repos.fileUrl(repoId, entry.icon), {
      maxBytes: REPO_LIMITS.iconBytes,
    });
    if (!data) throw new AppError('not_found', `${entry.icon} is missing`);
    this.cache.set(key, { data, at: now });
    return this.serve(data);
  }

  private serve(data: Buffer): ServedImage {
    if (!isPng(data)) throw new AppError('not_found', 'Extension icons must be PNG');
    return { data, contentType: 'image/png', sizeBytes: data.byteLength };
  }
}
