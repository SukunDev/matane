import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** `path`, or `path (2)`… when something else is already there. */
export async function freeTarget(path: string): Promise<string> {
  if (!(await exists(path))) return path;
  const ext = path.endsWith('.cbz') ? '.cbz' : '';
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

/** Whether `path` lies inside `folder` (not the folder itself). */
export function isInside(folder: string, path: string): boolean {
  const rel = relative(resolve(folder), resolve(path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Where `path` goes when everything under `from` moves to `to`. */
export function rebase(from: string, to: string, path: string): string {
  return resolve(to, relative(resolve(from), resolve(path)));
}

/**
 * Moves a file or folder, creating the parent. A rename when both are on one file system; across
 * devices it copies, then removes the original (a failed copy leaves the original untouched).
 * Returns the final path, which gets " (2)" when the target is taken.
 */
export async function movePath(from: string, to: string): Promise<string> {
  await mkdir(dirname(to), { recursive: true });
  const target = await freeTarget(to);
  try {
    await rename(from, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    try {
      await cp(from, target, { recursive: true, errorOnExist: true, force: false });
    } catch (copyError) {
      await rm(target, { recursive: true, force: true });
      throw copyError;
    }
    await rm(from, { recursive: true, force: true });
  }
  return target;
}
