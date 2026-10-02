import { open, readFile } from 'node:fs/promises';
import type { AppLicense, PackageKind } from '@manga-reader/shared';

/** Lines of the log at the end of the debug info. */
export const LOG_LINES = 100;

/**
 * Takes out what identifies the user: the home folder (and the user name in it), query strings
 * and fragments of URLs (tokens, ids), and anything that looks like a credential.
 */
export function scrub(text: string, home: string, user: string): string {
  let out = text;
  if (home) out = out.split(home).join('~');
  if (user && user.length > 2)
    out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '<user>');
  out = out.replace(/(https?:\/\/[^\s"'?#]+)[?#][^\s"']*/g, '$1?…');
  out = out.replace(/\bbearer\s+[^\s"',;]+/gi, 'Bearer <hidden>');
  out = out.replace(/\b(token|authorization|password|cookie|session)(["':=\s]+)[^\s"',;]+/gi, '$1$2<hidden>');
  return out;
}

export interface DebugFacts {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
  arch: string;
  locale: string;
  packaging: PackageKind;
  extensions: { id: string; version: string; origin: string; error: string | null }[];
  log: string;
}

/** The text "Copy debug info" puts on the clipboard, for a bug report (BRAINSTORM.md §10). */
export function debugInfo(facts: DebugFacts, scrubText: (text: string) => string): string {
  const lines = [
    '### Matane debug info',
    `Matane ${facts.version} (${facts.packaging}) · Electron ${facts.electron} · Chromium ${facts.chrome} · Node ${facts.node}`,
    `${facts.os} ${facts.arch} · ${facts.locale}`,
    '',
    `Extensions (${facts.extensions.length}):`,
    ...facts.extensions.map((e) => `- ${e.id}@${e.version} (${e.origin})${e.error ? ` error: ${e.error}` : ''}`),
    '',
    `Last ${LOG_LINES} log lines:`,
    '```',
    ...facts.log.trimEnd().split(/\r?\n/).slice(-LOG_LINES),
    '```',
  ];
  return scrubText(lines.join('\n'));
}

/** The end of a log file (enough for `LOG_LINES`), or nothing when there is no log yet. */
export async function logTail(file: string, bytes = 64 * 1024): Promise<string> {
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    // Drop the partial first line when the file was cut.
    return length < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}

/** The third-party licenses written at build (`build-tools/licenses.ts`); none in development. */
export async function readLicenses(file: string): Promise<AppLicense[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as AppLicense[];
  } catch {
    return [];
  }
}
