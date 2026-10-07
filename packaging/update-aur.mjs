#!/usr/bin/env node
// Fills packaging/aur/PKGBUILD for a release: the version and the sha256 of every source, then
// writes .SRCINFO next to it (without makepkg, so it runs on any OS).
//
//   node packaging/update-aur.mjs 1.0.0                       # downloads the release tar.gz
//   node packaging/update-aur.mjs 1.0.0 --tarball path.tar.gz # or hashes a local build
//
// The icon is hashed from apps/desktop/resources/icon.png, which is what the tag serves.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const aur = join(root, 'packaging', 'aur');
const [version, ...rest] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error('usage: node packaging/update-aur.mjs <version> [--tarball <file>]');
  process.exit(1);
}
const tarballFlag = rest.indexOf('--tarball');
const tarballPath = tarballFlag >= 0 ? rest[tarballFlag + 1] : null;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function tarball() {
  if (tarballPath) return readFile(tarballPath);
  const url = `https://github.com/mataneorg/matane/releases/download/v${version}/Matane-${version}-linux-x64.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sums = [
  sha256(await tarball()),
  sha256(await readFile(join(root, 'apps', 'desktop', 'resources', 'icon.png'))),
  sha256(await readFile(join(aur, 'matane.sh'))),
  sha256(await readFile(join(aur, 'matane.desktop'))),
];

let pkgbuild = await readFile(join(aur, 'PKGBUILD'), 'utf8');
pkgbuild = pkgbuild
  .replace(/^_pkgver=.*$/m, `_pkgver=${version}`)
  .replace(/^pkgrel=.*$/m, 'pkgrel=1')
  .replace(/^sha256sums=\([^)]*\)/m, `sha256sums=(${sums.map((s) => `'${s}'`).join('\n            ')})`);
await writeFile(join(aur, 'PKGBUILD'), pkgbuild);

// .SRCINFO: the fields of the PKGBUILD with the variables expanded.
const field = (name) => {
  const match =
    new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(pkgbuild) ?? new RegExp(`^${name}=(.*)$`, 'm').exec(pkgbuild);
  if (!match) return [];
  const raw = match[1].trim();
  return [...raw.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
};
const pkgver = version.replaceAll('-', '_');
const url = field('url')[0];
const expand = (value) =>
  value.replaceAll('${_pkgver}', version).replaceAll('${pkgver}', pkgver).replaceAll('${url}', url);
const lines = [
  `pkgbase = ${field('pkgname')[0]}`,
  `\tpkgdesc = ${field('pkgdesc')[0]}`,
  `\tpkgver = ${pkgver}`,
  `\tpkgrel = 1`,
  `\turl = ${url}`,
  ...field('arch').map((v) => `\tarch = ${v}`),
  ...field('license').map((v) => `\tlicense = ${v}`),
  ...field('depends').map((v) => `\tdepends = ${v}`),
  ...field('optdepends').map((v) => `\toptdepends = ${v}`),
  ...field('provides').map((v) => `\tprovides = ${v}`),
  ...field('conflicts').map((v) => `\tconflicts = ${v}`),
  ...field('options').map((v) => `\toptions = ${v}`),
  ...field('source').map((v) => `\tsource = ${expand(v)}`),
  ...sums.map((v) => `\tsha256sums = ${v}`),
  '',
  `pkgname = ${field('pkgname')[0]}`,
  '',
];
await writeFile(join(aur, '.SRCINFO'), lines.join('\n'));
console.log(`PKGBUILD and .SRCINFO updated for ${version}`);
