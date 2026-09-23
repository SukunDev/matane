import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type ExtensionManifest, SDK_API_VERSION, manifestSchema } from '@manga-reader/extension-sdk/manifest';
import { build as esbuild } from 'esbuild';

export interface BuildResult {
  outDir: string;
  manifest: ExtensionManifest;
  code: string;
  bytes: number;
}

// The bundle is an IIFE; its default export becomes the value the runtime looks for.
const GLOBAL_NAME = '__mrExtensionModule';
const FOOTER = `globalThis.__extension = ${GLOBAL_NAME}.default;`;
const ICON = 'icon.png';

export async function readManifest(dir: string): Promise<ExtensionManifest> {
  const file = path.join(dir, 'manifest.json');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid manifest.json:\n${issues.join('\n')}`);
  }
  if (parsed.data.apiVersion > SDK_API_VERSION) {
    throw new Error(`manifest.json targets apiVersion ${parsed.data.apiVersion}, this SDK supports ${SDK_API_VERSION}`);
  }
  return parsed.data;
}

/** Bundles `src/index.ts` into a self-contained ES2020 script and writes `dist/`. */
export async function buildExtension(
  dir: string,
  options: { minify?: boolean; /** Skip writing dist/ (tests). */ write?: boolean } = {},
): Promise<BuildResult> {
  const root = path.resolve(dir);
  const manifest = await readManifest(root);
  const outDir = path.join(root, 'dist');

  const result = await esbuild({
    entryPoints: [path.join(root, 'src/index.ts')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'iife',
    globalName: GLOBAL_NAME,
    footer: { js: FOOTER },
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    target: 'es2020',
    minify: options.minify ?? false,
    legalComments: 'none',
    charset: 'utf8',
    metafile: true,
    logLevel: 'silent',
  });

  // Anything left unresolved would need a module system the sandbox does not have.
  const leftovers = Object.values(result.metafile.outputs).flatMap((output) => output.imports.map((i) => i.path));
  if (leftovers.length > 0) {
    throw new Error(`Bundle still imports ${leftovers.join(', ')}; extensions must be self-contained`);
  }
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error('esbuild produced no output');
  if (/\brequire\s*\(/.test(code) && code.includes('__require')) {
    throw new Error('Bundle calls require(); a dependency expects Node.js and cannot run in the sandbox');
  }

  if (options.write === false) return { outDir, manifest, code, bytes: Buffer.byteLength(code) };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.js'), code);
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (await exists(path.join(root, ICON))) await copyFile(path.join(root, ICON), path.join(outDir, ICON));

  return { outDir, manifest, code, bytes: Buffer.byteLength(code) };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}
