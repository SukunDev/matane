import { join } from 'node:path';
import { BrowserWindow, type Rectangle, screen, shell } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import { broadcast } from '../ipc/register';

const WINDOW_STATE_KEY = 'window.state';
const DEFAULT_SIZE = { width: 1440, height: 900 };

interface WindowState {
  bounds: Partial<Rectangle> & { width: number; height: number };
  maximized: boolean;
}

/** Drop a saved position that no longer lands on any connected display. */
function isVisibleOnSomeDisplay(bounds: WindowState['bounds']): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return false;
  const { x, y, width, height } = bounds;
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y;
  });
}

export function createMainWindow(settings: SettingsRepository): BrowserWindow {
  const saved = settings.getValue<WindowState | null>(WINDOW_STATE_KEY, null);
  const bounds = saved && isVisibleOnSomeDisplay(saved.bounds) ? saved.bounds : DEFAULT_SIZE;
  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // Custom title bar (BRAINSTORM.md §6.6); macOS keeps its native traffic lights.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (saved?.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  const saveState = (): void => {
    if (window.isDestroyed()) return;
    const state: WindowState = {
      bounds: window.isMaximized() ? (saved?.bounds ?? DEFAULT_SIZE) : window.getNormalBounds(),
      maximized: window.isMaximized(),
    };
    settings.setValue(WINDOW_STATE_KEY, state);
  };
  window.on('close', saveState);

  window.on('maximize', () => broadcast('window.maximizeChanged', true));
  window.on('unmaximize', () => broadcast('window.maximizeChanged', false));
  window.on('enter-full-screen', () => broadcast('window.fullScreenChanged', true));
  window.on('leave-full-screen', () => broadcast('window.fullScreenChanged', false));

  // The renderer never navigates away or opens windows; external links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  return window;
}
