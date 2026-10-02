#!/usr/bin/env node
// Points packaging/flatpak at a release: the tar.gz URL and sha256 in the manifest, and a
// <release> entry in the metainfo (newest first). The Flathub repository takes both files.
//
//   node packaging/update-flatpak.mjs 1.0.0 [--date 2026-10-30] [--tarball path.tar.gz]
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'flatpak');
const [version, ...rest] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error('usage: node packaging/update-flatpak.mjs <version> [--date YYYY-MM-DD] [--tarball <file>]');
  process.exit(1);
}
const option = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : null;
};
const date = option('--date') ?? new Date().toISOString().slice(0, 10);
const url = `https://github.com/SukunDev/matane/releases/download/v${version}/Matane-${version}-linux-x64.tar.gz`;

async function tarball() {
  const local = option('--tarball');
  if (local) return readFile(local);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256 = hash(await tarball());
// The icon is served from the tag; it is the one in the repository.
const iconSha256 = hash(await readFile(join(dir, '..', '..', 'apps', 'desktop', 'resources', 'icon.png')));

const manifestPath = join(dir, 'dev.sukun.matane.yml');
const manifest = (await readFile(manifestPath, 'utf8'))
  .replace(/^(\s+url: )https:\/\/github\.com\/SukunDev\/matane\/releases\/.*$/m, `$1${url}`)
  .replace(/^(\s+url: https:\/\/github\.com\/SukunDev\/matane\/releases\/.*\n\s+sha256: )[0-9a-f]{64}$/m, `$1${sha256}`)
  .replace(
    /^(\s+url: )https:\/\/raw\.githubusercontent\.com\/SukunDev\/matane\/v[^/]+\//m,
    `$1https://raw.githubusercontent.com/SukunDev/matane/v${version}/`,
  )
  .replace(/^(\s+url: https:\/\/raw\.githubusercontent\.com\/.*\n\s+sha256: )[0-9a-f]{64}$/m, `$1${iconSha256}`);
await writeFile(manifestPath, manifest);

const metainfoPath = join(dir, 'dev.sukun.matane.metainfo.xml');
let metainfo = await readFile(metainfoPath, 'utf8');
if (!metainfo.includes(`<release version="${version}"`)) {
  const type = version.includes('-') ? 'development' : 'stable';
  metainfo = metainfo.replace(
    '<releases>\n',
    `<releases>\n    <release version="${version}" date="${date}" type="${type}"/>\n`,
  );
  await writeFile(metainfoPath, metainfo);
}
console.log(`Flatpak manifest and metainfo updated for ${version} (${sha256})`);
