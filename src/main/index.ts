import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import { openUdm } from '@core/udm';
import { registerIpc } from './ipc';

/**
 * Processo main di CrateForge.
 * Node è owner dell'UDM: crea il file in userData, applica lo schema e passa
 * il percorso al sidecar Python (via --udm-path) quando serve.
 */

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Il preload usa solo contextBridge/ipcRenderer: compatibile col sandbox,
      // che riduce l'impatto di un'eventuale compromissione del renderer.
      sandbox: true
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  // Apri all'esterno SOLO http/https: uno schema file:/custom da un renderer
  // compromesso diventerebbe apertura/esecuzione arbitraria lato OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    } catch {
      // URL malformato: ignora
    }
    return { action: 'deny' };
  });
  // Nessuna navigazione fuori dall'app (il renderer carica index.html locale).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Istanza singola: due processi sullo stesso udm.sqlite (più il sidecar)
// aumentano il rischio di lock/corruzione.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    const udmPath = join(app.getPath('userData'), 'udm.sqlite');
    let db;
    try {
      db = openUdm(udmPath);
    } catch (err) {
      // UDM corrotto/lockato o migrazione fallita: messaggio chiaro, non finestra muta.
      dialog.showErrorBox(
        'CrateForge non può avviarsi',
        `Il database interno non è apribile:\n${String(err)}\n\nPercorso: ${udmPath}`
      );
      app.quit();
      return;
    }
    const disposeIpc = registerIpc(db, udmPath);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Chiusura ordinata: ferma daemon/job, chiudi il DB (WAL pulito).
    app.on('before-quit', () => {
      try {
        disposeIpc?.();
      } catch {
        /* best-effort */
      }
      try {
        db.close();
      } catch {
        /* best-effort */
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
