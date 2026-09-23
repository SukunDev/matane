import { type FSWatcher, watch } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { SDK_API_VERSION } from '@manga-reader/extension-sdk';
import { type ExtensionManifest, manifestSchema } from '@manga-reader/extension-sdk/manifest';
import type { ExtensionEntry } from '@manga-reader/shared';

export type ExtensionOrigin = ExtensionEntry['origin'];

export interface RegisteredExtension {
  id: string;
  origin: ExtensionOrigin;
  /** Folder the user or app points at (a project folder or a built bundle). */
  path: string;
  /** Folder holding `manifest.json` + `index.js`. */
  bundleDir: string;
  manifest: ExtensionManifest | null;
  code: string | null;
  error: string | null;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Reads one extension. Accepts either a built bundle (`manifest.json` + `index.js`) or an extension
 * project whose `mr-ext build` output sits in `dist/`.
 */
export async function readExtension(path: string, origin: ExtensionOrigin): Promise<RegisteredExtension> {
  const root = resolve(path);
  const bundleDir = (await exists(join(root, 'dist', 'manifest.json'))) ? join(root, 'dist') : root;
  const broken = (error: string, id = basename(root)): RegisteredExtension => ({
    id,
    origin,
    path: root,
    bundleDir,
    manifest: null,
    code: null,
    error,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8'));
  } catch (error) {
    const hint = bundleDir === root ? ' (run `mr-ext build` first?)' : '';
    return broken(`Cannot read manifest.json${hint}: ${(error as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : undefined;
    return broken(
      `Invalid manifest.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      id,
    );
  }
  const manifest = parsed.data;
  if (manifest.apiVersion > SDK_API_VERSION) {
    return broken(`Needs extension API ${manifest.apiVersion}; this app supports ${SDK_API_VERSION}`, manifest.id);
  }
  let code: string;
  try {
    code = await readFile(join(bundleDir, 'index.js'), 'utf8');
  } catch (error) {
    return broken(`Cannot read index.js: ${(error as Error).message}`, manifest.id);
  }
  return { id: manifest.id, origin, path: root, bundleDir, manifest, code, error: null };
}

/** Every subfolder of `root` is an extension (`extensions/*` in the repo, `resources/extensions` when packaged). */
export async function readBuiltins(root: string): Promise<RegisteredExtension[]> {
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return Promise.all(names.sort().map((name) => readExtension(join(root, name), 'builtin')));
}

export interface RegistryOptions {
  builtinDir: string;
  devFolders: () => string[];
  /** Called (debounced) when a dev extension's bundle changes on disk. */
  onDevChange?: (extensionId: string) => void;
}

/** In-memory view of installed extensions. Dev folders override built-ins with the same id. */
export class ExtensionRegistry {
  private entries = new Map<string, RegisteredExtension>();
  private watchers: FSWatcher[] = [];

  constructor(private readonly options: RegistryOptions) {}

  async load(): Promise<RegisteredExtension[]> {
    const builtins = await readBuiltins(this.options.builtinDir);
    const dev = await Promise.all(this.options.devFolders().map((folder) => readExtension(folder, 'dev')));
    const next = new Map<string, RegisteredExtension>();
    for (const entry of [...builtins, ...dev]) {
      const current = next.get(entry.id);
      // A broken dev copy should not hide a working built-in.
      if (current && entry.error && !current.error) continue;
      next.set(entry.id, entry);
    }
    this.entries = next;
    this.watchDevFolders();
    return this.list();
  }

  list(): RegisteredExtension[] {
    return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): RegisteredExtension | undefined {
    return this.entries.get(id);
  }

  close(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private watchDevFolders(): void {
    this.close();
    if (!this.options.onDevChange) return;
    for (const entry of this.entries.values()) {
      if (entry.origin !== 'dev') continue;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const watcher = watch(entry.bundleDir, (_event, file) => {
          if (file !== 'index.js' && file !== 'manifest.json') return;
          clearTimeout(timer);
          timer = setTimeout(() => this.options.onDevChange?.(entry.id), 300);
        });
        this.watchers.push(watcher);
      } catch {
        // Folder vanished; the entry already carries an error or will on next load.
      }
    }
  }
}
