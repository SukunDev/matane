/**
 * Electron's default UA advertises "Electron/x" and the app name, which many sites block.
 * Extensions get a plain Chrome UA unless they set their own (some sites require one).
 */
export function browserUserAgent(electronUserAgent: string): string {
  return electronUserAgent
    .split(' ')
    .filter((token) => !/^(Electron|Matane|@manga-reader[^/]*)\//i.test(token))
    .join(' ');
}
