import { describe, expect, it } from 'vitest';
import { debugInfo, scrub } from './debug-info';
import { detectPackaging, isPackageManaged, updaterKindFor } from './packaging';

const detect = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  execPath = '/home/u/Matane/matane',
  packaged = true,
) => detectPackaging({ env, platform, execPath, packaged });

describe('packaging', () => {
  it('tells how Matane was installed', () => {
    expect(detect({}, 'linux', '/x', false)).toBe('dev');
    expect(detect({ APPIMAGE: '/home/u/Matane.AppImage' }, 'linux')).toBe('appimage');
    expect(detect({ FLATPAK_ID: 'dev.sukun.matane' }, 'linux', '/app/matane/matane')).toBe('flatpak');
    expect(detect({ MATANE_PACKAGE: 'aur' }, 'linux', '/opt/matane/matane')).toBe('aur');
    expect(detect({}, 'linux', '/opt/Matane/matane')).toBe('system');
    expect(detect({}, 'linux', '/home/u/Downloads/Matane-1.0.0/matane')).toBe('archive');
    expect(detect({ MATANE_PACKAGE: 'nonsense' }, 'linux', '/opt/Matane/matane')).toBe('system');
    expect(detect({ PORTABLE_EXECUTABLE_DIR: 'C:\\Tools' }, 'win32')).toBe('portable');
    expect(detect({}, 'win32')).toBe('nsis');
    expect(detect({}, 'darwin')).toBe('dmg');
  });

  it('updates itself only as AppImage and NSIS; package managers update the rest', () => {
    expect(updaterKindFor('appimage', false)).toBe('auto');
    expect(updaterKindFor('nsis', false)).toBe('auto');
    for (const kind of ['portable', 'dmg', 'flatpak', 'aur', 'system', 'archive'] as const) {
      expect(updaterKindFor(kind, false)).toBe('notify');
    }
    expect(updaterKindFor('dev', false)).toBe('none');
    expect(updaterKindFor('dev', true)).toBe('auto');
    expect(['flatpak', 'aur', 'system'].every((k) => isPackageManaged(k as never))).toBe(true);
    expect(isPackageManaged('appimage')).toBe(false);
  });
});

describe('debug info', () => {
  it('leaves out the home folder, the user name, URL queries and credentials', () => {
    const text = scrub(
      [
        'Loaded /home/alice/.config/Matane/data.db for alice',
        'GET https://api.example.com/manga?token=s3cret&id=7 → 200',
        'GET https://cdn.example.com/a.png#frag',
        'Authorization: Bearer abc.def',
        '{"password":"hunter2"}',
      ].join('\n'),
      '/home/alice',
      'alice',
    );
    expect(text).not.toContain('alice');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('abc.def');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('~/.config/Matane/data.db');
    expect(text).toContain('https://api.example.com/manga?…');
  });

  it('lists versions, extensions and the end of the log', () => {
    const log = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n');
    const text = debugInfo(
      {
        version: '1.0.0',
        electron: '44',
        chrome: '152',
        node: '24',
        os: 'Linux 6.0',
        arch: 'x64',
        locale: 'id',
        packaging: 'appimage',
        extensions: [{ id: 'mangadex', version: '1.2.0', origin: 'repo', error: null }],
        log,
      },
      (t) => t,
    );
    expect(text).toContain('Matane 1.0.0 (appimage)');
    expect(text).toContain('- mangadex@1.2.0 (repo)');
    expect(text).toContain('line 149');
    expect(text).toContain('line 50');
    expect(text).not.toContain('line 49\n');
  });
});
