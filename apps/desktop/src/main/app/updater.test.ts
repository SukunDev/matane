import { EventEmitter } from 'node:events';
import type { PackageKind, UpdaterSettings, UpdaterStatus } from '@manga-reader/shared';
import { describe, expect, it, vi } from 'vitest';
import { AppUpdater, type AutoUpdaterLike, type ReleaseInfo, compareVersions, newerRelease } from './updater';

describe('versions', () => {
  it('orders releases and pre-releases like semver', () => {
    const sorted = ['0.1.0-beta.10', '0.1.0', '0.1.0-beta.2', 'v0.2.0-beta.1', '0.1.0-alpha', '0.1.1'].sort(
      compareVersions,
    );
    expect(sorted).toEqual(['0.1.0-alpha', '0.1.0-beta.2', '0.1.0-beta.10', '0.1.0', '0.1.1', 'v0.2.0-beta.1']);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('picks the newest release of the channel', () => {
    const releases: ReleaseInfo[] = [
      { tag: 'v0.1.0-beta.3', prerelease: true, draft: false, url: 'b3' },
      { tag: 'v0.1.0-beta.4', prerelease: true, draft: true, url: 'draft' },
      { tag: 'v0.0.9', prerelease: false, draft: false, url: 'stable' },
    ];
    expect(newerRelease(releases, '0.1.0-beta.1', 'beta')?.url).toBe('b3');
    expect(newerRelease(releases, '0.1.0-beta.3', 'beta')).toBeUndefined();
    expect(newerRelease(releases, '0.0.8', 'stable')?.url).toBe('stable');
  });
});

/** Stands in for electron-updater's autoUpdater (an EventEmitter with the same fields). */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = true;
  next: 'available' | 'none' | 'error' = 'available';
  installed = false;
  async checkForUpdates() {
    if (this.next === 'error') throw new Error('Cannot find latest-linux.yml');
    if (this.next === 'none') {
      this.emit('update-not-available');
      return;
    }
    this.emit('update-available', { version: '0.1.0-beta.2' });
    if (this.autoDownload) await this.downloadUpdate();
  }
  async downloadUpdate() {
    this.emit('download-progress', { percent: 50.4 });
    this.emit('update-downloaded', { version: '0.1.0-beta.2' });
  }
  quitAndInstall() {
    this.installed = true;
  }
}

function setup(
  kind: UpdaterStatus['kind'],
  settings: UpdaterSettings,
  releases: ReleaseInfo[] = [],
  packaging: PackageKind = kind === 'auto' ? 'appimage' : 'archive',
) {
  const fake = new FakeUpdater();
  const notify = vi.fn();
  const states: string[] = [];
  const updater = new AppUpdater({
    kind,
    packaging,
    version: '0.1.0-beta.1',
    settings: () => settings,
    autoUpdater: () => fake as unknown as AutoUpdaterLike,
    fetchReleases: async () => releases,
    isOnline: () => true,
    notify,
    language: () => 'en',
    onStatus: (s) => states.push(s.state),
  });
  return { fake, notify, states, updater };
}

describe('AppUpdater', () => {
  it('downloads by itself on the beta channel, then installs on request', async () => {
    const { fake, notify, states, updater } = setup('auto', { mode: 'auto', channel: 'beta' });
    const status = await updater.check();
    expect(fake.allowPrerelease).toBe(true);
    expect(fake.allowDowngrade).toBe(false);
    expect(status).toMatchObject({ state: 'downloaded', version: '0.1.0-beta.2', progress: 100 });
    expect(states).toEqual(['checking', 'downloading', 'downloading', 'downloaded']);
    expect(notify).toHaveBeenCalledWith({ title: 'Matane 0.1.0-beta.2 is ready', body: 'Restart Matane to update.' });
    updater.install();
    expect(fake.installed).toBe(true);
  });

  it('only tells in "notify" mode, and downloads when asked', async () => {
    const { fake, notify, updater } = setup('auto', { mode: 'notify', channel: 'stable' });
    expect(await updater.check()).toMatchObject({ state: 'available', version: '0.1.0-beta.2' });
    expect(fake.autoDownload).toBe(false);
    expect(fake.allowPrerelease).toBe(false);
    expect(notify).toHaveBeenCalledWith({ title: 'Matane 0.1.0-beta.2 is available', body: 'See Settings → About.' });
    await updater.download();
    expect(updater.getStatus().state).toBe('downloaded');
  });

  it('reports "latest" and errors', async () => {
    const { fake, updater } = setup('auto', { mode: 'auto', channel: 'beta' });
    fake.next = 'none';
    expect((await updater.check()).state).toBe('latest');
    fake.next = 'error';
    expect(await updater.check()).toMatchObject({ state: 'error', error: 'Cannot find latest-linux.yml' });
  });

  it('only links the release page where it cannot install', async () => {
    const releases = [{ tag: 'v0.1.0-beta.2', prerelease: true, draft: false, url: 'https://x/v0.1.0-beta.2' }];
    const { notify, updater } = setup('notify', { mode: 'auto', channel: 'beta' }, releases);
    expect(await updater.check()).toMatchObject({
      state: 'available',
      version: '0.1.0-beta.2',
      releaseUrl: 'https://x/v0.1.0-beta.2',
    });
    await updater.check();
    expect(notify).toHaveBeenCalledTimes(1); // once per version
    updater.install();
    const none = setup('none', { mode: 'auto', channel: 'beta' });
    expect((await none.updater.check()).state).toBe('idle');
  });

  it('points package manager installs at their package manager', async () => {
    const releases = [{ tag: 'v0.1.0-beta.2', prerelease: true, draft: false, url: 'https://x/v0.1.0-beta.2' }];
    const flatpak = setup('notify', { mode: 'auto', channel: 'beta' }, releases, 'flatpak');
    expect((await flatpak.updater.check()).packaging).toBe('flatpak');
    expect(flatpak.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringMatching(/package manager/) }),
    );
    const archive = setup('notify', { mode: 'auto', channel: 'beta' }, releases);
    await archive.updater.check();
    expect(archive.notify).toHaveBeenCalledWith(expect.objectContaining({ body: 'See Settings → About.' }));
  });
});
