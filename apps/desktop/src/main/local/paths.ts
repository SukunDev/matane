import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { AppError } from '@manga-reader/shared/errors';

const inside = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * Resolves a url (relative to the local folder) to a real path, and refuses anything that leaves
 * the folder: `..`, absolute paths, and symlinks that point outside. Every read of the local source
 * goes through here; the urls come from the database and from the renderer.
 */
export async function safeJoin(root: string, relative: string): Promise<string> {
  const outside = () => new AppError('not_found', `"${relative}" is not inside the local folder`);
  if (typeof relative !== 'string' || relative.includes('\0') || isAbsolute(relative)) throw outside();
  if (relative.split(/[\\/]+/).some((part) => part === '..')) throw outside();
  const base = await realpath(root).catch(() => {
    throw new AppError('not_found', `The local folder ${root} cannot be opened`);
  });
  const target = resolve(base, relative);
  if (!inside(base, target)) throw outside();
  const real = await realpath(target).catch(() => {
    throw new AppError('not_found', `"${relative}" does not exist in the local folder`);
  });
  if (!inside(base, real)) throw outside();
  return real;
}
