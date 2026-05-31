import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;

function getCliPath(): string {
  if (isDev) {
    return join(__dirname, '..', '..', 'cli', 'dist', 'index.js');
  }
  const p = join(process.resourcesPath, 'cli', 'index.js');
  if (!existsSync(p)) {
    throw new Error(`CLI not found at ${p}. Run 'pnpm build' first.`);
  }
  return p;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    title: 'Agent-X',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`file://${join(__dirname, '..', 'renderer', 'index.html')}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const trayIconPath = join(__dirname, '..', 'build', process.platform === 'darwin' ? 'Tray.png' : 'TrayWin.png');
  const icon = existsSync(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Agent-X',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Agent-X');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  setTimeout(() => {
    if (mainWindow) {
      new Notification({
        title: 'Agent-X',
        body: 'Running in the background. Click the tray icon to open.',
      }).show();
    }
  }, 10000);
}

function registerHotkey(): void {
  const registered = globalShortcut.register('Alt+A', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  if (!registered) {
    console.warn('Failed to register global hotkey Alt+A');
  }
}

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.logger = console;
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    if (mainWindow) {
      new Notification({
        title: 'Update Available',
        body: 'Downloading Agent-X update...',
      }).show();
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      new Notification({
        title: 'Update Ready',
        body: 'Restart Agent-X to apply the update.',
      }).show();
    }
  });
}

// PTY terminal
import type { IPty } from 'node-pty';

let ptyProcess: IPty | null = null;

ipcMain.on('pty:write', (_e, data: string) => {
  ptyProcess?.write(data);
});

ipcMain.on('pty:resize', (_e, { cols, rows }: { cols: number; rows: number }) => {
  try { ptyProcess?.resize(cols, rows); } catch { /* ignore */ }
});

ipcMain.handle('pty:spawn', async () => {
  try {
    const { spawn } = await import('node-pty');
    const cliPath = getCliPath();
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'node';
    const args = process.platform === 'win32' ? [] : [cliPath];

    ptyProcess = spawn(shell, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '3' },
    });

    ptyProcess.onData((data: string) => {
      mainWindow?.webContents.send('pty:data', data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      mainWindow?.webContents.send('pty:exit', { exitCode, signal });
      ptyProcess = null;
    });

    return { ok: true };
  } catch (e) {
    console.error('PTY spawn failed:', e);
    return { ok: false, error: (e as Error).message };
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerHotkey();
  setupAutoUpdater();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});
