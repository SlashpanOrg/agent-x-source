import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, protocol } from 'electron';
import { join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;

function getCliPath(): string {
  if (isDev) {
    return join(__dirname, '..', '..', 'cli', 'dist', 'index.js');
  }
  return join(process.resourcesPath, 'cli', 'index.js');
}

function registerNodeProtocol(): void {
  protocol.handle('node', (request) => {
    const url = new URL(request.url);
    const filePath = resolve(join(__dirname, '..', url.pathname));
    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      js: 'application/javascript',
      css: 'text/css',
      json: 'application/json',
      png: 'image/png',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
    };
    const contentType = mimeTypes[ext ?? ''] ?? 'application/octet-stream';
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    });
  });
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
  const icon = nativeImage.createEmpty();
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
let ptyProcess: unknown = null;

ipcMain.handle('pty:spawn', async () => {
  try {
    const { spawn } = await import('node-pty');
    const cliPath = getCliPath();
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'node';
    const args = process.platform === 'win32' ? [] : [cliPath];

    ptyProcess = spawn(shell, args, {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '3' },
    });

    (ptyProcess as { onData: (cb: (data: string) => void) => void }).onData((data: string) => {
      mainWindow?.webContents.send('pty:data', data);
    });

    (ptyProcess as { onExit: (cb: (info: { exitCode: number; signal: number }) => void) => void }).onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
      mainWindow?.webContents.send('pty:exit', { exitCode, signal });
    });

    ipcMain.on('pty:write', (_e: Electron.IpcMainEvent, data: string) => {
      (ptyProcess as { write: (data: string) => void }).write(data);
    });

    ipcMain.on('pty:resize', (_e: Electron.IpcMainEvent, { cols, rows }: { cols: number; rows: number }) => {
      (ptyProcess as { resize: (cols: number, rows: number) => void }).resize(cols, rows);
    });

    return { ok: true };
  } catch (e) {
    console.error('PTY spawn failed:', e);
    return { ok: false, error: (e as Error).message };
  }
});

app.whenReady().then(() => {
  registerNodeProtocol();
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
