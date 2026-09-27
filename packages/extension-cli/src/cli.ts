import { Command, InvalidArgumentError } from 'commander';
import { runBenchmark } from './bench';
import { buildExtension } from './build';
import { createExtension } from './create';
import { CLI_NAME, CLI_VERSION } from './node-host';
import { KEY_ENV, buildRepo, loadPrivateKey, repoKeygen, verifyRepo } from './repo';
import { runSmokeTest } from './smoke';

const collect = (value: string, previous: string[]) => [...previous, value];

function parseKeyValues(pairs: string[]): Record<string, unknown> {
  return Object.fromEntries(
    pairs.map((pair) => {
      const at = pair.indexOf('=');
      if (at <= 0) throw new InvalidArgumentError(`expected key=value, got "${pair}"`);
      const raw = pair.slice(at + 1);
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        // Plain strings stay strings.
      }
      return [pair.slice(0, at), value];
    }),
  );
}

const program = new Command()
  .name(CLI_NAME)
  .description('Create, build and test Manga Reader extensions')
  .version(CLI_VERSION);

program
  .command('create')
  .description('scaffold a new extension')
  .argument('<id>', 'extension id (lowercase, dashes)')
  .option('--name <name>', 'display name')
  .option('--domain <domain>', 'site domain', 'example.com')
  .option('--lang <lang>', 'source language', 'en')
  .option('--dir <dir>', 'parent directory', '.')
  .action(async (id: string, opts: { name?: string; domain: string; lang: string; dir: string }) => {
    const dir = await createExtension(opts.dir, { id, name: opts.name, domain: opts.domain, lang: opts.lang });
    console.log(`Created ${dir}`);
  });

program
  .command('build')
  .description('bundle src/index.ts into dist/ (index.js + manifest.json)')
  .argument('[dir]', 'extension directory', '.')
  .option('--minify', 'minify the bundle')
  .action(async (dir: string, opts: { minify?: boolean }) => {
    const result = await buildExtension(dir, { minify: opts.minify });
    console.log(
      `Built ${result.manifest.id} ${result.manifest.version} → ${result.outDir} (${(result.bytes / 1024).toFixed(1)} KB)`,
    );
  });

program
  .command('test')
  .description('build, then run popular → details → chapters → pages against the real site')
  .argument('[dir]', 'extension directory', '.')
  .option('-s, --source <key>', 'source key to test (repeatable; default: all)', collect, [])
  .option('-q, --query <text>', 'search instead of listing popular')
  .option('-u, --url <url>', 'resolve a web URL instead of listing')
  .option('-p, --pick <n>', 'which listed manga to open (default: first with chapters)', (v) => Number.parseInt(v, 10))
  .option('--pref <key=value>', 'preference override (repeatable)', collect, [])
  .option('--filter <id=value>', 'search filter value, JSON allowed (repeatable)', collect, [])
  .option('--no-image', 'skip fetching the first page image')
  .option('-v, --verbose', 'print every request')
  .action(
    async (
      dir: string,
      opts: {
        source: string[];
        query?: string;
        url?: string;
        pick?: number;
        pref: string[];
        filter: string[];
        image: boolean;
        verbose?: boolean;
      },
    ) => {
      const { ok } = await runSmokeTest({
        dir,
        sources: opts.source,
        query: opts.query,
        url: opts.url,
        pick: opts.pick,
        prefs: parseKeyValues(opts.pref),
        filters: parseKeyValues(opts.filter) as never,
        image: opts.image,
        verbose: opts.verbose,
      });
      process.exitCode = ok ? 0 : 1;
    },
  );

program
  .command('bench')
  .description('measure call time (sandbox vs network) and QuickJS heap, plus synthetic worst cases')
  .argument('[dir]', 'extension directory', '.')
  .option('-r, --runs <n>', 'runs per case', (v) => Number.parseInt(v, 10), 5)
  .option('--fixtures <dir>', 'replay recorded responses (see createFixtureHost) instead of the network')
  .option('-s, --source <key>', 'source key (default: first)')
  .option('--manga <url>', 'manga url to open instead of the first popular one')
  .option('--no-synthetic', 'skip the synthetic stress cases')
  .action(
    async (
      dir: string,
      opts: { runs: number; fixtures?: string; source?: string; manga?: string; synthetic: boolean },
    ) => {
      await runBenchmark({
        dir,
        runs: opts.runs,
        fixtures: opts.fixtures,
        source: opts.source,
        manga: opts.manga,
        skipSynthetic: !opts.synthetic,
      });
    },
  );

const repo = program.command('repo').description('build, sign and check an extension repository');

repo
  .command('keygen')
  .description('create an ed25519 signing key; prints the public key')
  .requiredOption('--out <file>', 'where to write the private key (PEM); keep it out of git')
  .action(async (opts: { out: string }) => {
    const publicKey = await repoKeygen(opts.out);
    console.log(`Private key written to ${opts.out} (keep it secret; in CI put it in $${KEY_ENV}).`);
    console.log(`Public key: ${publicKey}`);
  });

repo
  .command('build')
  .description('zip, hash and index extensions into a repository folder, then sign index.json')
  .argument('<extensions...>', 'extension folders (sources with src/index.ts, or built with index.js)')
  .requiredOption('-o, --out <dir>', 'repository folder to (re)write')
  .option('--name <name>', 'repository name shown in the app', 'Extensions')
  .option('--key <file>', `private key (PEM); default: $${KEY_ENV}`)
  .option('--unsigned', 'write no signature (the app will call the repository unverified)')
  .action(async (extensions: string[], opts: { out: string; name: string; key?: string; unsigned?: boolean }) => {
    const privateKeyPem = await loadPrivateKey(opts.key);
    if (!privateKeyPem && !opts.unsigned) {
      throw new Error(`No signing key: pass --key <file>, set $${KEY_ENV}, or --unsigned`);
    }
    const { index, signed } = await buildRepo({
      extensions,
      outDir: opts.out,
      name: opts.name,
      privateKeyPem: opts.unsigned ? undefined : privateKeyPem,
    });
    for (const entry of index.extensions) console.log(`  ${entry.id} ${entry.version}  ${entry.sha256}`);
    console.log(
      `Wrote ${index.extensions.length} extension(s) to ${opts.out}, ${signed ? `signed by ${index.publicKey}` : 'unsigned'}`,
    );
  });

repo
  .command('verify')
  .description('check the signature, index and every archive of a repository')
  .argument('<source>', 'repository folder or URL')
  .option('--public-key <key>', 'the ed25519:… key the repository must be signed with')
  .action(async (source: string, opts: { publicKey?: string }) => {
    const result = await verifyRepo({ source, publicKey: opts.publicKey });
    const { signature, index, problems } = result;
    if (index) console.log(`${index.name}: ${index.extensions.length} extension(s)`);
    if (signature.valid) {
      console.log(
        `Signature valid for ${signature.key}${signature.trusted ? '' : ' (the key named in the index; pass --public-key to check trust)'}`,
      );
    }
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    if (problems.length > 0) {
      console.error(`${problems.length} problem(s)`);
      process.exitCode = 1;
    } else {
      console.log('OK');
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`${CLI_NAME}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
