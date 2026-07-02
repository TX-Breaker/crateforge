import { contextBridge, ipcRenderer } from 'electron';

/**
 * Bridge sicuro renderer ↔ main. Espone solo funzioni tipizzate, niente
 * accesso diretto a Node dal renderer.
 */
const api = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<string | null>,
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },
  sidecar: {
    check: () => ipcRenderer.invoke('sidecar:check')
  },
  library: {
    page: (q: { offset: number; limit: number; search?: string; needsReview?: boolean }) =>
      ipcRenderer.invoke('library:page', q),
    stats: () => ipcRenderer.invoke('library:stats'),
    ingestXml: (xmlPath: string) => ipcRenderer.invoke('library:ingestXml', xmlPath),
    ingestMasterdb: (dbPath: string, optionsPath?: string) =>
      ipcRenderer.invoke('library:ingestMasterdb', dbPath, optionsPath)
  },
  backup: {
    plan: (opts: unknown) => ipcRenderer.invoke('backup:plan', opts),
    execute: (planId: string) => ipcRenderer.invoke('backup:execute', planId)
  },
  orphans: {
    scan: (musicDir: string) => ipcRenderer.invoke('orphans:scan', musicDir),
    quarantine: (files: string[], root: string, dryRun: boolean) =>
      ipcRenderer.invoke('orphans:quarantine', files, root, dryRun)
  },
  report: {
    generate: (opts: unknown) => ipcRenderer.invoke('report:generate', opts)
  },
  exporter: {
    limits: () => ipcRenderer.invoke('export:limits'),
    rekordboxXml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:rekordboxXml', outPath, sel),
    traktorNml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:traktorNml', outPath, sel),
    virtualdjXml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:virtualdjXml', outPath, sel)
  },
  relocator: {
    findBroken: () => ipcRenderer.invoke('relocator:findBroken'),
    matchAndWrite: (newRoot: string, outPath: string | null) =>
      ipcRenderer.invoke('relocator:matchAndWrite', newRoot, outPath)
  },
  oplog: {
    list: (limit?: number) => ipcRenderer.invoke('oplog:list', limit),
    exportTxt: (outPath: string) => ipcRenderer.invoke('oplog:export', outPath)
  },
  dialog: {
    openFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:openFile', filters),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    saveFile: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveFile', defaultName, filters)
  },
  jobs: {
    cancel: () => ipcRenderer.invoke('job:cancel'),
    onProgress: (
      cb: (p: { jobId: string; phase: string; done: number; total: number }) => void
    ) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { jobId: string; phase: string; done: number; total: number }
      ) => cb(payload);
      ipcRenderer.on('job:progress', listener);
      return () => {
        ipcRenderer.removeListener('job:progress', listener);
      };
    }
  }
};

export type CrateForgeApi = typeof api;

contextBridge.exposeInMainWorld('crateforge', api);
