import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, dialog, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { autoUpdater } from 'electron-updater';
import type { Server } from 'http';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let server: Server | null = null;
const PORT = 3333;

const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getWebApiPath(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-api', 'dist', 'index.js');
  return join(process.resourcesPath, 'web-api', 'index.js');
}

function getWebUiDir(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-ui', 'dist');
  return join(process.resourcesPath, 'web-ui');
}

async function startServer(): Promise<void> {
  const apiPath = getWebApiPath();
  const uiDir = getWebUiDir();

  if (!existsSync(apiPath)) {
    throw new Error(`Web-API not found at ${apiPath}`);
  }

  // Set UI dir before importing the server module
  process.env['AGENTX_UI_DIR'] = uiDir;
  process.env['PORT'] = String(PORT);
  process.env['NODE_ENV'] = 'production';

  // Dynamically import the ESM web-api bundle — it creates an Express server and listens
  const mod = await import(apiPath);
  // The server is created internally and listens on PORT. Capture it for cleanup.
  // The module exports may vary; we just need it to start listening.
  if (mod.server) server = mod.server as Server;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 500,
    title: 'Agent-X', show: false, backgroundColor: '#0d1117',
    titleBarStyle: 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'bottom' });
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });
}

function createTray(): void {
  let icon: Electron.NativeImage;
  const candidates = [
    join(__dirname, '..', 'build', process.platform === 'darwin' ? 'Tray.png' : 'TrayWin.png'),
    join(__dirname, '..', 'build', 'icon.png'),
    join(process.resourcesPath, 'build', 'icon.png'),
  ];
  const found = candidates.find(p => existsSync(p));
  if (found) {
    icon = nativeImage.createFromPath(found).resize({ width: 16, height: 16 });
  } else {
    // Create a simple 16x16 fallback icon programmatically
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('Agent-X — Starting...');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Agent-X', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit Agent-X', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}

function registerHotkey(): void {
  const ok = globalShortcut.register('Alt+A', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
  if (!ok) console.warn('Failed to register global hotkey Alt+A');
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose a project folder',
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

function setupAutoUpdater(): void {
  if (isDev) return;
  autoUpdater.logger = console;
  autoUpdater.checkForUpdatesAndNotify();
  autoUpdater.on('update-available', () => {
    if (mainWindow) new Notification({ title: 'Update Available', body: 'Downloading update...' }).show();
  });
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) new Notification({ title: 'Update Ready', body: 'Restart to apply.' }).show();
  });
}

app.whenReady().then(async () => {
  try {
    // Show tray icon immediately so user knows daemon is starting
    createTray();
    await startServer();
    tray?.setToolTip(`Agent-X — Running on port ${PORT}`);
    createWindow();
    registerHotkey();
    setupAutoUpdater();
    // Notify user daemon is running in background
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        new Notification({ title: 'Agent-X', body: 'Running in the background. Click the tray icon to open.' }).show();
      }
    }, 2000);
  } catch (err) {
    console.error('Failed to start:', err);
    app.quit();
  }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); stopServer(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});
app.on('before-quit', () => { isQuitting = true; });
