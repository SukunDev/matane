import { execFile } from 'node:child_process';

export interface TraySupport {
  available: boolean;
  /** Why not (shown next to the disabled setting). */
  reason: string | null;
}

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(command, args, { timeout: 2000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

/**
 * Whether a system tray will show (BRAINSTORM.md §6.4). Windows and macOS always have one. On Linux,
 * Electron's tray needs a StatusNotifier host (KDE, Cinnamon, XFCE… or GNOME with the AppIndicator
 * extension): it is there when someone owns `org.kde.StatusNotifierWatcher` on the session bus.
 * Without a way to ask (no `gdbus`/`dbus-send`), the tray is assumed to work.
 */
export async function detectTraySupport(platform: NodeJS.Platform = process.platform): Promise<TraySupport> {
  if (platform !== 'linux') return { available: true, reason: null };
  const name = 'org.kde.StatusNotifierWatcher';
  const attempts: [string, string[]][] = [
    [
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.DBus',
        '--object-path',
        '/org/freedesktop/DBus',
        '--method',
        'org.freedesktop.DBus.NameHasOwner',
        name,
      ],
    ],
    [
      'dbus-send',
      [
        '--session',
        '--print-reply',
        '--dest=org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus.NameHasOwner',
        `string:${name}`,
      ],
    ],
  ];
  for (const [command, args] of attempts) {
    try {
      const out = await run(command, args);
      return /true/.test(out) ? { available: true, reason: null } : { available: false, reason: 'no-status-notifier' };
    } catch {
      // try the next tool
    }
  }
  return { available: true, reason: null };
}
