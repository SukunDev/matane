// Compares the repository just built into public/ with the one that is published, and fails when an
// extension changed without a higher version (the app would never offer that change) or when a
// version went down. Builds are reproducible, so a different sha256 means different contents.
//
//   node scripts/check-versions.mjs https://<owner>.github.io/matane-extensions/
import { readFile } from 'node:fs/promises';

const base = process.argv[2];
if (!base) {
  console.log('No published repository URL (set the REPO_URL variable); skipping the version check.');
  process.exit(0);
}

/** Semver precedence, enough for extension versions ("1.2.0" < "1.10.0", "1.0.0-beta.1" < "1.0.0"). */
function compare(a, b) {
  const [coreA = '', preA] = a.split(/-(.*)/s, 2);
  const [coreB = '', preB] = b.split(/-(.*)/s, 2);
  const x = coreA.split('.').map(Number);
  const y = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  if (!preA || !preB) return (preB ? 1 : 0) - (preA ? 1 : 0);
  return preA < preB ? -1 : preA > preB ? 1 : 0;
}

const built = JSON.parse(await readFile('public/index.json', 'utf8'));
const response = await fetch(new URL('index.json', base.endsWith('/') ? base : `${base}/`), {
  cache: 'no-store',
});
if (response.status === 404) {
  console.log('Nothing is published yet; skipping the version check.');
  process.exit(0);
}
if (!response.ok) throw new Error(`Cannot read the published index: HTTP ${response.status}`);
const published = await response.json();

const problems = [];
for (const extension of built.extensions) {
  const before = published.extensions.find((e) => e.id === extension.id);
  if (!before) {
    console.log(`  new      ${extension.id} ${extension.version}`);
    continue;
  }
  const order = compare(extension.version, before.version);
  if (order < 0) problems.push(`${extension.id}: version went down (${before.version} → ${extension.version})`);
  else if (order === 0 && extension.sha256 !== before.sha256) {
    problems.push(`${extension.id} ${extension.version}: changed without a version bump (bump "version" in manifest.json)`);
  } else if (order > 0) console.log(`  update   ${extension.id} ${before.version} → ${extension.version}`);
  else console.log(`  same     ${extension.id} ${extension.version}`);
}
for (const gone of published.extensions.filter((p) => !built.extensions.some((e) => e.id === p.id))) {
  console.log(`  removed  ${gone.id} (installed copies stay installed, without updates)`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log('Versions OK');
