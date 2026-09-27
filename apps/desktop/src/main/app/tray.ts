import type { DownloadStats, UpdateProgress } from '@manga-reader/shared';
import { Menu, type MenuItemConstructorOptions, Tray, nativeImage } from 'electron';

export interface TrayStatus {
  downloads: DownloadStats;
  update: UpdateProgress | null;
  online: boolean;
}

const STRINGS = {
  en: {
    open: 'Open Matane',
    check: 'Check for updates now',
    pause: 'Pause downloads',
    resume: 'Resume downloads',
    quit: 'Quit',
    idle: 'Nothing running',
    offline: 'Offline',
    checking: (done: number, total: number) => `Checking for updates ${done}/${total}`,
    downloading: (n: number, queued: number) => `Downloading ${n} · ${queued} in queue`,
    paused: (n: number) => `${n} download${n === 1 ? '' : 's'} paused`,
  },
  id: {
    open: 'Buka Matane',
    check: 'Cek update sekarang',
    pause: 'Jeda download',
    resume: 'Lanjutkan download',
    quit: 'Keluar',
    idle: 'Tidak ada yang berjalan',
    offline: 'Offline',
    checking: (done: number, total: number) => `Mengecek update ${done}/${total}`,
    downloading: (n: number, queued: number) => `Mengunduh ${n} · ${queued} di antrean`,
    paused: (n: number) => `${n} download dijeda`,
  },
};

/** The short status lines at the top of the tray menu (and its tooltip). */
export function trayStatusLines(language: string, status: TrayStatus): string[] {
  const s = language.startsWith('id') ? STRINGS.id : STRINGS.en;
  const lines: string[] = [];
  if (!status.online) lines.push(s.offline);
  if (status.update) lines.push(s.checking(status.update.done, status.update.total));
  const { downloading, queued, paused } = status.downloads;
  if (downloading > 0 || queued > 0) lines.push(s.downloading(downloading, queued));
  else if (paused > 0) lines.push(s.paused(paused));
  return lines.length > 0 ? lines : [s.idle];
}

export interface AppTrayDeps {
  iconPath: string;
  language: () => string;
  status: () => TrayStatus;
  open: () => void;
  checkUpdates: () => void;
  pauseDownloads: () => void;
  resumeDownloads: () => void;
  quit: () => void;
}

/**
 * The optional tray icon (BRAINSTORM.md §6.4): open, check now, pause/resume downloads, a short
 * status and quit. It exists only while "close to tray" is on.
 */
export class AppTray {
  private tray: Tray | null = null;

  constructor(private readonly deps: AppTrayDeps) {}

  get enabled(): boolean {
    return this.tray !== null;
  }

  enable(): void {
    if (this.tray) return;
    const size = process.platform === 'darwin' ? 18 : 24;
    const icon = nativeImage.createFromPath(this.deps.iconPath).resize({ width: size, height: size });
    this.tray = new Tray(icon);
    this.tray.on('click', () => this.deps.open());
    this.refresh();
  }

  disable(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  /** Rebuilds the menu from the current status (called when downloads or checks change). */
  refresh(): void {
    if (!this.tray) return;
    const language = this.deps.language();
    const s = language.startsWith('id') ? STRINGS.id : STRINGS.en;
    const status = this.deps.status();
    const lines = trayStatusLines(language, status);
    const { downloading, queued, paused } = status.downloads;
    const running = downloading + queued > 0;
    const template: MenuItemConstructorOptions[] = [
      ...lines.map((label) => ({ label, enabled: false })),
      { type: 'separator' },
      { label: s.open, click: () => this.deps.open() },
      {
        label: s.check,
        enabled: status.online && status.update === null,
        click: () => this.deps.checkUpdates(),
      },
      running
        ? { label: s.pause, click: () => this.deps.pauseDownloads() }
        : { label: s.resume, enabled: paused > 0, click: () => this.deps.resumeDownloads() },
      { type: 'separator' },
      { label: s.quit, click: () => this.deps.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(`Matane\n${lines.join('\n')}`);
  }
}
