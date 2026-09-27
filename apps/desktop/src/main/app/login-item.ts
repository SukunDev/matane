import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Started at login with this, the app may stay in the tray. */
export const HIDDEN_ARG = '--hidden';

export interface LaunchCommand {
  /** The executable: the AppImage when running from one, else the app (or Electron in dev). */
  executable: string;
  /** Extra arguments before ours (the app folder in dev). */
  args: string[];
}

/** `~/.config/autostart` (XDG), where Linux desktops look for programs to start at login. */
export function autostartDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'autostart');
}

const quote = (arg: string) => (/[\s"'\\$`]/.test(arg) ? `"${arg.replace(/(["\\$`])/g, '\\$1')}"` : arg);

/** The `.desktop` entry that starts Matane at login (freedesktop autostart spec). */
export function autostartEntry(command: LaunchCommand, hidden: boolean): string {
  const exec = [command.executable, ...command.args, ...(hidden ? [HIDDEN_ARG] : [])].map(quote).join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Matane',
    'Comment=Manga reader',
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export interface LoginItemDeps {
  platform: NodeJS.Platform;
  command: LaunchCommand;
  /** `app.setLoginItemSettings` (Windows and macOS). */
  setLoginItemSettings: (settings: Electron.Settings) => void;
  dir?: string;
}

/**
 * Starts Matane at login or stops doing so (BRAINSTORM.md §6.4): Windows and macOS through
 * `app.setLoginItemSettings`, Linux with `~/.config/autostart/matane.desktop`, written again each
 * time so a moved AppImage is picked up.
 */
export async function applyLoginItem(
  deps: LoginItemDeps,
  settings: { openAtLogin: boolean; startHidden: boolean },
): Promise<void> {
  if (deps.platform === 'linux') {
    const dir = deps.dir ?? autostartDir();
    const file = join(dir, 'matane.desktop');
    if (!settings.openAtLogin) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, autostartEntry(deps.command, settings.startHidden));
    return;
  }
  // `args` reach the app on Windows only; macOS always opens the window.
  deps.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    args: settings.startHidden ? [HIDDEN_ARG] : [],
  });
}
