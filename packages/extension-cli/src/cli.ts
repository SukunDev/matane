import { Command, InvalidArgumentError } from 'commander';
import { runBenchmark } from './bench';
import { buildExtension } from './build';
import { createExtension } from './create';
import { CLI_NAME, CLI_VERSION } from './node-host';
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

program.parseAsync().catch((error: unknown) => {
  console.error(`${CLI_NAME}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
