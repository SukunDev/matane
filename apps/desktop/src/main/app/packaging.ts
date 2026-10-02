import { PACKAGE_KINDS, PACKAGE_MANAGED, type PackageKind } from '@manga-reader/shared';

/**
 * How this copy was installed (ADR 0021). Packages that set it themselves win (`MATANE_PACKAGE` in
 * the AUR and Flatpak launchers); then the runtime tells: an AppImage sets `APPIMAGE`, Flatpak
 * `FLATPAK_ID`, the portable exe `PORTABLE_EXECUTABLE_DIR`; deb and rpm install under /opt or /usr.
 */
export function detectPackaging(options: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  execPath: string;
  packaged: boolean;
}): PackageKind {
  const { env, platform, execPath } = options;
  if (!options.packaged) return 'dev';
  const declared = env['MATANE_PACKAGE'];
  if (declared && (PACKAGE_KINDS as readonly string[]).includes(declared)) return declared as PackageKind;
  if (platform === 'linux') {
    if (env['APPIMAGE']) return 'appimage';
    if (env['FLATPAK_ID']) return 'flatpak';
    if (execPath.startsWith('/opt/') || execPath.startsWith('/usr/')) return 'system';
    return 'archive';
  }
  if (platform === 'win32') return env['PORTABLE_EXECUTABLE_DIR'] ? 'portable' : 'nsis';
  return 'dmg';
}

/** Updates itself (AppImage, NSIS), only tells (everything else), or none (development). */
export function updaterKindFor(packaging: PackageKind, testFeed: boolean): 'auto' | 'notify' | 'none' {
  if (testFeed && packaging === 'dev') return 'auto';
  if (packaging === 'dev') return 'none';
  return packaging === 'appimage' || packaging === 'nsis' ? 'auto' : 'notify';
}

export const isPackageManaged = (packaging: PackageKind) => PACKAGE_MANAGED.includes(packaging);
