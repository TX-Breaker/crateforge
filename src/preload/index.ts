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
  security: {
    // Attiva/disattiva un gate (directWrites/masterDbWrites) con conferma
    // nativa nel main. Le chiavi di gate NON passano da settings.set.
    setGate: (key: 'directWrites' | 'masterDbWrites', enable: boolean) =>
      ipcRenderer.invoke('security:setGate', key, enable) as Promise<{ ok: boolean; enabled: boolean }>
  },
  sidecar: {
    check: () => ipcRenderer.invoke('sidecar:check'),
    downloadKey: () => ipcRenderer.invoke('sidecar:downloadKey')
  },
  library: {
    page: (q: { offset: number; limit: number; search?: string; needsReview?: boolean }) =>
      ipcRenderer.invoke('library:page', q),
    pageByPlaylist: (playlistId: number, offset: number, limit: number) =>
      ipcRenderer.invoke('library:pageByPlaylist', playlistId, offset, limit),
    stats: () => ipcRenderer.invoke('library:stats'),
    ingestXml: (xmlPath: string) => ipcRenderer.invoke('library:ingestXml', xmlPath),
    ingestMasterdb: (dbPath: string, optionsPath?: string) =>
      ipcRenderer.invoke('library:ingestMasterdb', dbPath, optionsPath),
    importForeign: (kind: 'traktor' | 'virtualdj' | 'engine', path: string) =>
      ipcRenderer.invoke('library:importForeign', kind, path),
    // Serato (sperimentale): riceve la cartella "_Serato_".
    importSerato: (seratoDir: string) => ipcRenderer.invoke('library:importSerato', seratoDir)
  },
  backup: {
    plan: (opts: unknown) => ipcRenderer.invoke('backup:plan', opts),
    execute: (planId: string) => ipcRenderer.invoke('backup:execute', planId)
  },
  orphans: {
    scan: (musicDir: string) => ipcRenderer.invoke('orphans:scan', musicDir),
    quarantine: (files: string[], root: string, dryRun: boolean) =>
      ipcRenderer.invoke('orphans:quarantine', files, root, dryRun),
    remove: (scanId: string, files: string[], dryRun: boolean) =>
      ipcRenderer.invoke('orphans:delete', scanId, files, dryRun)
  },
  report: {
    generate: (opts: unknown) => ipcRenderer.invoke('report:generate', opts),
    view: (filePath: string, offset: number, limit: number) =>
      ipcRenderer.invoke('report:view', filePath, offset, limit)
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
  // Fase 2 — funzioni sperimentali (modalità Esperto)
  dedup: {
    run: () => ipcRenderer.invoke('dedup:run')
  },
  relocatorFp: {
    match: (newRoot: string) => ipcRenderer.invoke('relocator:fingerprintMatch', newRoot),
    writeXml: (outPath: string) => ipcRenderer.invoke('relocator:writeFingerprintXml', outPath)
  },
  cues: {
    analyze: (trackId: number) => ipcRenderer.invoke('cues:analyze', trackId),
    save: (
      trackId: number,
      cues: { label: string; positionMs: number; color: string | null }[]
    ) => ipcRenderer.invoke('cues:save', trackId, cues)
  },
  tagger: {
    propose: (limit?: number, provider?: 'musicbrainz' | 'discogs') =>
      ipcRenderer.invoke('tagger:propose', limit, provider),
    apply: (proposals: unknown[], target?: 'udm' | 'original') =>
      ipcRenderer.invoke('tagger:apply', proposals, target)
  },
  stems: {
    run: (trackId: number, outDir: string) => ipcRenderer.invoke('stems:run', trackId, outDir)
  },
  // Fase 3 — power user (modalità Esperto)
  watcher: {
    start: (folder: string) => ipcRenderer.invoke('watcher:start', folder),
    stop: () => ipcRenderer.invoke('watcher:stop'),
    status: () => ipcRenderer.invoke('watcher:status'),
    scan: (folder: string) => ipcRenderer.invoke('watcher:scan', folder),
    onNewItems: (cb: (p: { added: number }) => void) => {
      const listener = (_e: unknown, payload: { added: number }) => cb(payload);
      ipcRenderer.on('inbox:new-items', listener);
      return () => {
        ipcRenderer.removeListener('inbox:new-items', listener);
      };
    }
  },
  inbox: {
    list: (status?: 'new' | 'prepared' | 'dismissed') => ipcRenderer.invoke('inbox:list', status),
    setStatus: (ids: number[], status: 'new' | 'prepared' | 'dismissed') =>
      ipcRenderer.invoke('inbox:setStatus', ids, status),
    prepareXml: (ids: number[], outPath: string) =>
      ipcRenderer.invoke('inbox:prepareXml', ids, outPath)
  },
  planner: {
    playlists: () => ipcRenderer.invoke('planner:playlists'),
    analyze: (playlistId: number) => ipcRenderer.invoke('planner:analyze', playlistId)
  },
  siae: {
    readHistory: (masterDbPath: string) => ipcRenderer.invoke('siae:readHistory', masterDbPath),
    sessions: () => ipcRenderer.invoke('siae:sessions'),
    export: (sessionId: string, outPath: string, venue?: string, eventDate?: string) =>
      ipcRenderer.invoke('siae:export', sessionId, outPath, venue, eventDate)
  },
  health: {
    get: () => ipcRenderer.invoke('health:get')
  },
  setbuilder: {
    build: (startTrackId: number, length: number, curve: 'up' | 'flat' | 'down') =>
      ipcRenderer.invoke('setbuilder:build', startTrackId, length, curve),
    exportXml: (trackIds: number[], playlistName: string, outPath: string) =>
      ipcRenderer.invoke('setbuilder:exportXml', trackIds, playlistName, outPath)
  },
  masterdb: {
    createPlaylist: (
      trackIds: number[],
      playlistName: string,
      masterDbPath: string,
      optionsJsonPath: string | null
    ) =>
      ipcRenderer.invoke('masterdb:createPlaylist', trackIds, playlistName, masterDbPath, optionsJsonPath)
  },
  dialog: {
    // defaultPath (opzionale) pre-punta il dialog su un file/cartella: usato per
    // aprire di default il master.db di Rekordbox dell'utente.
    openFile: (filters?: { name: string; extensions: string[] }[], defaultPath?: string) =>
      ipcRenderer.invoke('dialog:openFile', filters, defaultPath),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    saveFile: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveFile', defaultName, filters)
  },
  // Percorsi di default dell'installazione Rekordbox dell'utente corrente.
  rekordbox: {
    defaultPaths: () =>
      ipcRenderer.invoke('rekordbox:defaultPaths') as Promise<{
        dir: string;
        masterDb: string;
        masterDbExists: boolean;
        optionsJson: string;
        optionsJsonExists: boolean;
      }>
  },
  // Preflight all'avvio: sidecar eseguibile + chiave di lettura pronta.
  preflight: {
    get: () => ipcRenderer.invoke('preflight:get'),
    rerun: () => ipcRenderer.invoke('preflight:rerun'),
    onUpdate: (cb: (state: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state);
      ipcRenderer.on('preflight:update', listener);
      return () => {
        ipcRenderer.removeListener('preflight:update', listener);
      };
    }
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
