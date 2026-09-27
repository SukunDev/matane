import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLoginItem, autostartDir, autostartEntry } from './login-item';
import { OnlineMonitor } from './online';
import { trayStatusLines } from './tray';

// Electron's Tray/Menu are not available under plain Node; only the pure parts are tested here.
vi.mock('electron', () => ({ Menu: {}, Tray: class {}, nativeImage: {} }));

describe('OnlineMonitor', () => {
  it('tells listeners when the network changes, and a forced state wins', () => {
    let network = true;
    const monitor = new OnlineMonitor(() => network);
    const seen: boolean[] = [];
    monitor.onChange((online) => seen.push(online));
    monitor.poll();
    network = false;
    monitor.poll();
    network = true;
    monitor.poll();
    monitor.override(false);
    monitor.poll(); // still forced
    monitor.override(null);
    expect(seen).toEqual([false, true, false, true]);
    expect(monitor.isOnline()).toBe(true);
  });
});

describe('start at login', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'matane-autostart-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes an autostart entry that quotes paths and can start hidden', () => {
    const entry = autostartEntry({ executable: '/home/me/Apps/Matane 0.1.AppImage', args: [] }, true);
    expect(entry).toContain('Exec="/home/me/Apps/Matane 0.1.AppImage" --hidden\n');
    expect(entry).toContain('Type=Application');
    expect(autostartEntry({ executable: '/usr/bin/electron', args: ['/src/app'] }, false)).toContain(
      'Exec=/usr/bin/electron /src/app\n',
    );
    expect(autostartDir({ XDG_CONFIG_HOME: '/x' })).toBe(join('/x', 'autostart'));
  });

  it('creates and removes the file on Linux, and uses the login item elsewhere', async () => {
    const setLoginItemSettings = vi.fn();
    const deps = { platform: 'linux' as const, command: { executable: '/a', args: [] }, setLoginItemSettings, dir };
    await applyLoginItem(deps, { openAtLogin: true, startHidden: false });
    expect(readFileSync(join(dir, 'matane.desktop'), 'utf8')).toContain('Exec=/a\n');
    await applyLoginItem(deps, { openAtLogin: false, startHidden: false });
    expect(existsSync(join(dir, 'matane.desktop'))).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();

    await applyLoginItem({ ...deps, platform: 'win32' }, { openAtLogin: true, startHidden: true });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] });
  });
});

describe('tray status', () => {
  const downloads = { queued: 0, downloading: 0, paused: 0, error: 0, done: 0, totalBytes: 0 };
  it('sums up what runs, in the app language', () => {
    expect(trayStatusLines('en', { downloads, update: null, online: true })).toEqual(['Nothing running']);
    expect(
      trayStatusLines('en', {
        downloads: { ...downloads, downloading: 2, queued: 3 },
        update: { running: true, done: 4, total: 10, current: [], newChapters: 0, errors: 0 },
        online: false,
      }),
    ).toEqual(['Offline', 'Checking for updates 4/10', 'Downloading 2 · 3 in queue']);
    expect(trayStatusLines('id', { downloads: { ...downloads, paused: 2 }, update: null, online: true })).toEqual([
      '2 download dijeda',
    ]);
  });
});
