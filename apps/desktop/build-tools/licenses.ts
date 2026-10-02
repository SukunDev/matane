import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import type { Plugin } from 'vite';

/** One package the app ships, for Settings → About → Licenses. */
export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  repository: string | null;
  text: string | null;
}

/** Our own packages (GPL app, MIT extension tooling) are not third-party. */
const OWN = /^@(manga-reader|matane)\//;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/**
 * Where `name` resolves from `from` (node_modules lookup, without `require.resolve`: many packages'
 * `exports` do not expose package.json).
 */
function findPackage(from: string, name: string): string | null {
  const require = createRequire(join(from, 'package.json'));
  for (const base of require.resolve.paths(name) ?? []) {
    const dir = join(base, name);
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return null;
}

/** The package folder a bundled module file belongs to (pnpm layout aware). */
export function packageDirOf(file: string): string | null {
  const marker = `${sep}node_modules${sep}`;
  const index = file.lastIndexOf(marker);
  if (index < 0) return null;
  const rest = file.slice(index + marker.length).split(sep);
  const name = rest[0]?.startsWith('@') ? `${rest[0]}${sep}${rest[1]}` : rest[0];
  return name ? file.slice(0, index + marker.length) + name : null;
}

function read(dir: string): LicenseEntry & { private: boolean; deps: string[] } {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    private?: boolean;
    license?: string | { type?: string };
    licenses?: { type?: string }[];
    repository?: string | { url?: string };
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : (pkg.license?.type ?? pkg.licenses?.map((l) => l.type).join(' OR ') ?? 'UNKNOWN');
  const repository = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? null);
  const file = readdirSync(dir).find((name) => LICENSE_FILE.test(name));
  return {
    name: pkg.name,
    version: pkg.version,
    license,
    repository: repository?.replace(/^git\+/, '').replace(/\.git$/, '') ?? null,
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : null,
    private: pkg.private === true,
    deps: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})],
  };
}

/**
 * The runtime packages of the app (`dependencies` of apps/desktop and theirs, as installed) plus
 * the packages bundled into the renderer, with their license texts: `out/licenses.json`.
 */
export function collectLicenses(root: string, bundledDirs: Iterable<string>): LicenseEntry[] {
  const seen = new Map<string, LicenseEntry>();
  const visit = (dir: string) => {
    const real = realpathSync(dir);
    if (seen.has(real) || !existsSync(join(real, 'package.json'))) return;
    const entry = read(real);
    seen.set(real, entry);
    for (const dep of entry.deps) {
      // Optional or platform-specific packages may not be installed here.
      const found = findPackage(real, dep);
      if (found) visit(found);
    }
  };
  const app = read(root);
  for (const dep of app.deps) {
    const found = findPackage(root, dep);
    if (found) visit(found);
  }
  for (const dir of bundledDirs) if (existsSync(join(dir, 'package.json'))) visit(dir);
  const byName = new Map<string, LicenseEntry>();
  for (const entry of seen.values()) {
    if (OWN.test(entry.name) || (entry as { private?: boolean }).private) continue;
    byName.set(`${entry.name}@${entry.version}`, {
      name: entry.name,
      version: entry.version,
      license: entry.license,
      repository: entry.repository,
      text: entry.text,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Vite plugin for the renderer build: writes `out/licenses.json` once the bundle is known. */
export function licensesPlugin(root: string, outFile: string): Plugin {
  const bundled = new Set<string>();
  return {
    name: 'matane-licenses',
    apply: 'build',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        const dir = packageDirOf(id.replace(/\?.*$/, ''));
        if (dir) bundled.add(dir);
      }
    },
    closeBundle() {
      writeFileSync(outFile, JSON.stringify(collectLicenses(root, bundled)));
    },
  };
}
