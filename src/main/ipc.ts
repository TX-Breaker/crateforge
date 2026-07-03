import { BrowserWindow, dialog, ipcMain } from 'electron';
import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  getPlaylistTracksPage,
  getSetting,
  getTracksPage,
  logOperation,
  setSetting
} from '@core/udm';
import { ingestCollectionXml } from '@core/xmlCollection';
import { executeBackup, planBackup, BackupOptions, BackupPlan } from '@services/backup/incrementalBackup';
import { deleteOrphans, findOrphans, quarantineOrphans } from '@services/orphans/orphanFinder';
import { generateExcelReport } from '@services/excel/reportGenerator';
import { readReportPage } from '@services/excel/reportViewer';
import { findBrokenTracks, matchByFilename, RelocationMatch } from '@services/relocator/relocator';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { REKORDBOX_XML_LIMITS } from '@adapters/common';
import { SERATO_STATUS } from '@adapters/serato';
import { ENGINE_STATUS } from '@adapters/engine';
import { applyProposals, proposeTags, TagProposal, TagProvider } from '@services/tagger/autoTagger';
import { app } from 'electron';
import { join, basename } from 'path';
import { copyFileSync, mkdirSync } from 'fs';
import { listInbox, setInboxStatus, SyncDaemon } from '@services/watcher/syncDaemon';
import { analyzePlaylist, listPlaylists } from '@services/planner/setPlanner';
import { buildSet, BpmCurve } from '@services/setbuilder/setBuilder';
import { computeHealth } from '@core/health';
import { writeInboxXml } from '@adapters/rekordbox/inboxXml';
import { writeSetXml } from '@adapters/rekordbox/setXml';
import type { TrackRow } from '@core/udm';
import { ThrottledProgress } from './progress';
import { checkSidecar, runSidecar, SidecarEvent } from './sidecar';

/**
 * Registrazione handler IPC. Regole:
 *  - mai bulk data attraverso il bridge: la UI riceve pagine, non librerie;
 *  - progressi SEMPRE via ThrottledProgress (§2);
 *  - un solo job di ingestion alla volta (serializza i writer sull'UDM).
 */
export function registerIpc(db: BetterSqlite3.Database, udmPath: string): void {
  let ingestionRunning = false;
  let currentCancel: (() => void) | null = null;
  // Piani di backup tenuti nel main: al renderer va solo il riepilogo (§2, no bulk data su IPC).
  const backupPlans = new Map<string, { plan: BackupPlan; opts: BackupOptions }>();

  const win = (): BrowserWindow => BrowserWindow.getAllWindows()[0];

  // ---- settings / stato ----
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(db, key));
  ipcMain.handle('settings:set', (_e, key: string, value: string) => setSetting(db, key, value));
  ipcMain.handle('sidecar:check', () => checkSidecar());

  // Fallback chiave Rekordbox (§4.3) in-app: nessun terminale, nessun sito.
  // Registrato qui ma usa runSidecarJob (definito sotto) solo a runtime.
  ipcMain.handle('sidecar:downloadKey', async () => {
    const check = checkSidecar();
    if (!check.available) {
      return { ok: false, message: 'Modulo di lettura non disponibile su questo computer.' };
    }
    const r = await runSidecarJob('download-key', 'download-key', []);
    logOperation(db, 'sidecar.download-key', null, r.ok ? 'ok' : 'error', r.ok ? undefined : r.message);
    return r;
  });
  ipcMain.handle('export:limits', () => ({
    rekordboxXml: REKORDBOX_XML_LIMITS,
    serato: SERATO_STATUS,
    engine: ENGINE_STATUS
  }));

  // ---- libreria (paginata) ----
  ipcMain.handle('library:page', (_e, q) => getTracksPage(db, q));
  ipcMain.handle('library:pageByPlaylist', (_e, playlistId: number, offset: number, limit: number) =>
    getPlaylistTracksPage(db, playlistId, offset, Math.min(limit, 200))
  );
  ipcMain.handle('library:stats', () => ({
    tracks: (db.prepare('SELECT COUNT(*) c FROM tracks').get() as { c: number }).c,
    playlists: (db.prepare('SELECT COUNT(*) c FROM playlists').get() as { c: number }).c,
    needsReview: (
      db.prepare('SELECT COUNT(*) c FROM tracks WHERE needs_review = 1').get() as { c: number }
    ).c,
    lastIngest: db
      .prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1')
      .get()
  }));

  // ---- ingestion XML (percorso pure-Node, modalità solo-XML) ----
  ipcMain.handle('library:ingestXml', async (_e, xmlPath: string) => {
    if (ingestionRunning) throw new Error('Un\'altra importazione è già in corso.');
    ingestionRunning = true;
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    try {
      const result = ingestCollectionXml(db, xmlPath, (done, total) =>
        progress.update({ jobId, phase: 'ingest-xml', done, total })
      );
      progress.finish({ jobId, phase: 'ingest-xml', done: result.tracks, total: result.tracks });
      logOperation(db, 'ingest.xml', xmlPath, 'ok', JSON.stringify(result));
      return result;
    } catch (err) {
      logOperation(db, 'ingest.xml', xmlPath, 'error', String(err));
      throw err;
    } finally {
      ingestionRunning = false;
    }
  });

  // ---- ingestion master.db (sidecar Python; sola lettura sul sorgente) ----
  ipcMain.handle(
    'library:ingestMasterdb',
    async (_e, masterDbPath: string, optionsJsonPath?: string) => {
      if (ingestionRunning) throw new Error('Un\'altra importazione è già in corso.');
      const check = checkSidecar();
      if (!check.available) {
        return {
          ok: false,
          fallbackXml: true,
          message:
            'Il modulo di lettura diretta non è disponibile. Puoi comunque usare la modalità ' +
            'solo-XML: esporta la collection da Rekordbox (File → Export Collection in xml format) ' +
            'e importala da qui.'
        };
      }
      ingestionRunning = true;
      const progress = new ThrottledProgress(win().webContents);
      const jobId = randomUUID();
      const args = ['--master-db', masterDbPath];
      if (optionsJsonPath) args.push('--options-json', optionsJsonPath);
      let lastError: string | null = null;

      const handle = runSidecar({
        command: 'ingest-masterdb',
        udmPath,
        args,
        onEvent: (ev) => {
          if (ev.type === 'progress') {
            progress.update({
              jobId,
              phase: ev.phase ?? 'ingest-masterdb',
              done: ev.done ?? 0,
              total: ev.total ?? 0
            });
          } else if (ev.type === 'error') {
            lastError = ev.message ?? 'Errore sconosciuto del sidecar';
          }
        }
      });
      currentCancel = handle.cancel;
      try {
        const { code } = await handle.finished;
        progress.finish({ jobId, phase: 'ingest-masterdb', done: 1, total: 1 });
        if (code !== 0) {
          logOperation(db, 'ingest.masterdb', masterDbPath, 'error', lastError ?? `exit ${code}`);
          return {
            ok: false,
            fallbackXml: true,
            message:
              (lastError ?? 'Lettura del database non riuscita.') +
              ' Puoi usare la modalità solo-XML (esporta la collection da Rekordbox e importala qui)' +
              ' oppure, in modalità Esperto: Impostazioni → "Scarica chiave di lettura" e riprova.'
          };
        }
        logOperation(db, 'ingest.masterdb', masterDbPath, 'ok');
        return { ok: true };
      } finally {
        ingestionRunning = false;
        currentCancel = null;
      }
    }
  );

  ipcMain.handle('job:cancel', () => {
    currentCancel?.();
    return true;
  });

  // ---- backup ----
  ipcMain.handle('backup:plan', async (_e, opts: BackupOptions) => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    const plan = await planBackup({
      ...opts,
      onProgress: (done, total, phase) => progress.update({ jobId, phase, done, total })
    });
    progress.finish({ jobId, phase: 'scan', done: plan.scannedFiles, total: plan.scannedFiles });
    const planId = randomUUID();
    backupPlans.set(planId, { plan, opts });
    logOperation(db, 'backup.plan', opts.musicDir, 'dry-run', `${plan.items.length} file da copiare`);
    // Al renderer: solo riepilogo + anteprima limitata, mai la lista completa.
    return {
      planId,
      scannedFiles: plan.scannedFiles,
      toCopy: plan.items.length,
      totalBytes: plan.totalBytes,
      dbSnapshotDir: plan.dbSnapshotDir,
      preview: plan.items.slice(0, 50).map((i) => ({ src: i.src, reason: i.reason }))
    };
  });

  ipcMain.handle('backup:execute', async (_e, planId: string) => {
    const entry = backupPlans.get(planId);
    if (!entry) throw new Error('Piano di backup scaduto: rilancia l\'anteprima.');
    backupPlans.delete(planId);
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    const result = await executeBackup(entry.plan, {
      ...entry.opts,
      onProgress: (done, total, phase) => progress.update({ jobId, phase, done, total })
    });
    progress.finish({ jobId, phase: 'copy', done: result.copied, total: result.copied });
    logOperation(
      db,
      'backup.execute',
      entry.opts.backupDir,
      result.failed.length ? 'error' : 'ok',
      `${result.copied} copiati, ${result.failed.length} falliti`
    );
    return result;
  });

  // ---- orfani ----
  ipcMain.handle('orphans:scan', async (_e, musicDir: string) => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    const result = await findOrphans(db, musicDir, (scanned) =>
      progress.update({ jobId, phase: 'orphan-scan', done: scanned, total: 0 })
    );
    progress.finish({
      jobId,
      phase: 'orphan-scan',
      done: result.scannedFiles,
      total: result.scannedFiles
    });
    logOperation(db, 'orphans.scan', musicDir, 'ok', `${result.orphans.length} orfani`);
    // Lista orfani: può essere lunga, il renderer la pagina lato UI (array di
    // sole stringhe+numeri, non oggetti pesanti).
    return result;
  });

  ipcMain.handle(
    'orphans:quarantine',
    (_e, files: string[], quarantineRoot: string, dryRun: boolean) =>
      quarantineOrphans(db, files, quarantineRoot, dryRun)
  );

  // Eliminazione definitiva: SOLO con il setting "scritture dirette" attivo
  // (fase intermedia). Il gate è anche qui nel main, non solo in UI.
  ipcMain.handle('orphans:delete', (_e, files: string[], dryRun: boolean) => {
    if (getSetting(db, 'directWrites') !== '1') {
      throw new Error(
        'Le scritture dirette sono disattivate. Attivale in Impostazioni → Esperto.'
      );
    }
    return deleteOrphans(db, files, dryRun);
  });

  // ---- report excel ----
  ipcMain.handle('report:generate', async (_e, opts) => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    const result = await generateExcelReport(db, {
      ...opts,
      onProgress: (done: number, total: number) =>
        progress.update({ jobId, phase: 'excel', done, total })
    });
    progress.finish({ jobId, phase: 'excel', done: result.rows, total: result.rows });
    logOperation(db, 'report.excel', result.outPath, 'ok', `${result.rows} righe`);
    return result;
  });

  // Visualizzatore report: pagine di max 500 righe, mai il file intero su IPC.
  ipcMain.handle('report:view', (_e, filePath: string, offset: number, limit: number) =>
    readReportPage(filePath, offset, limit)
  );

  // ---- export ----
  ipcMain.handle('export:rekordboxXml', (_e, outPath: string, sel) => {
    const r = writeRekordboxXml(db, outPath, sel ?? {});
    logOperation(db, 'export.rekordbox-xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });
  ipcMain.handle('export:traktorNml', (_e, outPath: string, sel) => {
    const r = writeTraktorNml(db, outPath, sel ?? {});
    logOperation(db, 'export.traktor-nml', outPath, 'ok', JSON.stringify(r));
    return r;
  });
  ipcMain.handle('export:virtualdjXml', (_e, outPath: string, sel) => {
    const r = writeVirtualDjXml(db, outPath, sel ?? {});
    logOperation(db, 'export.virtualdj-xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });

  // ---- relocator ----
  ipcMain.handle('relocator:findBroken', () => {
    const broken = findBrokenTracks(db);
    return broken.map((b) => ({
      trackId: b.track.id,
      title: b.track.title,
      artist: b.track.artist,
      oldPath: b.oldPath
    }));
  });
  ipcMain.handle('relocator:matchAndWrite', async (_e, newRoot: string, outPath: string | null) => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    const broken = findBrokenTracks(db);
    const matches: RelocationMatch[] = await matchByFilename(broken, newRoot, (scanned) =>
      progress.update({ jobId, phase: 'relocate-scan', done: scanned, total: 0 })
    );
    progress.finish({ jobId, phase: 'relocate-scan', done: 1, total: 1 });
    const summary = {
      broken: broken.length,
      matched: matches.filter((m) => m.newPath).length,
      ambiguous: matches.filter((m) => m.ambiguous.length > 0).length,
      written: 0
    };
    if (outPath) {
      // outPath presente = l'utente ha già confermato nel wizard (dry-run prima).
      const r = writeRelocationXml(matches, outPath);
      summary.written = r.written;
      logOperation(db, 'relocator.xml', outPath, 'ok', JSON.stringify(summary));
    } else {
      logOperation(db, 'relocator.dry-run', newRoot, 'dry-run', JSON.stringify(summary));
    }
    return summary;
  });

  // ---- oplog ----
  ipcMain.handle('oplog:list', (_e, limit = 200) =>
    db.prepare('SELECT * FROM oplog ORDER BY id DESC LIMIT ?').all(Math.min(limit, 1000))
  );

  // Export del registro in testo leggibile (§3.7), scritto a blocchi.
  ipcMain.handle('oplog:export', async (_e, outPath: string) => {
    const { createWriteStream } = await import('fs');
    const stream = createWriteStream(outPath, { encoding: 'utf-8' });
    stream.write('Registro operazioni CrateForge\n================================\n\n');
    for (const row of db
      .prepare('SELECT * FROM oplog ORDER BY id DESC')
      .iterate() as IterableIterator<{
      ts: string;
      operation: string;
      target: string | null;
      outcome: string;
      detail: string | null;
    }>) {
      stream.write(
        `[${row.ts}] ${row.operation} — ${row.outcome}` +
          (row.target ? `\n  su: ${row.target}` : '') +
          (row.detail ? `\n  dettagli: ${row.detail}` : '') +
          '\n'
      );
    }
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
    logOperation(db, 'oplog.export', outPath, 'ok');
    return { outPath };
  });

  // =====================================================================
  // FASE 2 — funzioni sperimentali (modalità Esperto)
  // =====================================================================

  /** Esegue un comando sidecar con progressi throttlati; ritorna l'evento done. */
  const runSidecarJob = (
    command: string,
    phase: string,
    args: string[]
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; message?: string }> => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    let doneData: Record<string, unknown> | undefined;
    let lastError: string | null = null;
    const handle = runSidecar({
      command,
      udmPath,
      args,
      onEvent: (ev: SidecarEvent) => {
        if (ev.type === 'progress') {
          progress.update({ jobId, phase: ev.phase ?? phase, done: ev.done ?? 0, total: ev.total ?? 0 });
        } else if (ev.type === 'done') {
          doneData = ev.data;
        } else if (ev.type === 'error') {
          lastError = ev.message ?? 'Errore sconosciuto del sidecar';
        }
      }
    });
    currentCancel = handle.cancel;
    return handle.finished.then(({ code }) => {
      progress.finish({ jobId, phase, done: 1, total: 1 });
      currentCancel = null;
      if (code !== 0 || !doneData) {
        return { ok: false as const, message: lastError ?? `Il modulo è terminato con codice ${code}.` };
      }
      return { ok: true as const, data: doneData };
    });
  };

  // ---- dedup per fingerprint (Fase 2.2) ----
  ipcMain.handle('dedup:run', async () => {
    const r = await runSidecarJob('fingerprint-batch', 'fingerprint', []);
    if (!r.ok) {
      logOperation(db, 'dedup.fingerprint', null, 'error', r.message);
      return { ok: false, message: r.message };
    }
    // Gruppi con lo stesso acoustic_id (bounded: max 500 gruppi al renderer).
    const groups = db
      .prepare(
        `SELECT acoustic_id, COUNT(*) AS c FROM tracks
         WHERE acoustic_id IS NOT NULL
         GROUP BY acoustic_id HAVING c > 1
         ORDER BY c DESC LIMIT 500`
      )
      .all() as { acoustic_id: string; c: number }[];
    const trackStmt = db.prepare(
      `SELECT id, title, artist, path, filesize, duration_s FROM tracks WHERE acoustic_id = ?`
    );
    const result = groups.map((g) => ({
      acousticId: g.acoustic_id,
      tracks: trackStmt.all(g.acoustic_id) as Pick<
        TrackRow,
        'id' | 'title' | 'artist' | 'path' | 'filesize' | 'duration_s'
      >[]
    }));
    logOperation(db, 'dedup.fingerprint', null, 'ok', `${result.length} gruppi di duplicati`);
    return { ok: true, stats: r.data, groups: result };
  });

  // ---- relocator per fingerprint (Fase 2.3) ----
  ipcMain.handle('relocator:fingerprintMatch', async (_e, newRoot: string) => {
    const r = await runSidecarJob('match-fingerprints', 'relocate-fingerprint', [
      '--new-root',
      newRoot
    ]);
    if (!r.ok) {
      logOperation(db, 'relocator.fingerprint', newRoot, 'error', r.message);
      return { ok: false, message: r.message };
    }
    logOperation(db, 'relocator.fingerprint', newRoot, 'dry-run', JSON.stringify(r.data));
    return { ok: true, ...r.data };
  });

  ipcMain.handle('relocator:writeFingerprintXml', (_e, outPath: string) => {
    const rows = db
      .prepare(
        `SELECT rm.new_path, t.* FROM relocation_matches rm
         JOIN tracks t ON t.id = rm.track_id
         WHERE rm.method = 'fingerprint'`
      )
      .all() as ({ new_path: string } & TrackRow)[];
    const matches = rows.map((row) => {
      const { new_path, ...track } = row;
      return {
        track: track as TrackRow,
        oldPath: track.path ?? '',
        newPath: new_path,
        ambiguous: []
      };
    });
    const r = writeRelocationXml(matches, outPath);
    logOperation(db, 'relocator.fingerprint.xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });

  // ---- auto-cue assistito (Fase 2.1) ----
  ipcMain.handle('cues:analyze', async (_e, trackId: number) => {
    const t = db.prepare(`SELECT id, path FROM tracks WHERE id = ?`).get(trackId) as
      | { id: number; path: string | null }
      | undefined;
    if (!t?.path) return { ok: false, message: 'Brano senza percorso file.' };
    const r = await runSidecarJob('analyze-cues', 'analyze-cues', [
      '--file',
      t.path,
      '--track-id',
      String(trackId)
    ]);
    if (!r.ok) {
      logOperation(db, 'cues.analyze', t.path, 'error', r.message);
      return { ok: false, message: r.message };
    }
    logOperation(db, 'cues.analyze', t.path, 'ok');
    return { ok: true, ...r.data };
  });

  // L'utente ha rivisto/spostato i cue proposti e ha cliccato salva:
  // scriviamo nell'UDM (mai nel master.db; verso Rekordbox si passa dall'XML).
  ipcMain.handle(
    'cues:save',
    (_e, trackId: number, cues: { label: string; positionMs: number; color: string | null }[]) => {
      const capped = cues.slice(0, 8); // limite hot cue import XML (§4)
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM cues WHERE track_id = ? AND cue_type = 'hot'`).run(trackId);
        const ins = db.prepare(
          `INSERT INTO cues (track_id, cue_type, cue_index, position_ms, color, label)
           VALUES (?, 'hot', ?, ?, ?, ?)`
        );
        capped.forEach((c, i) => ins.run(trackId, i, c.positionMs, c.color, c.label));
      });
      tx();
      logOperation(db, 'cues.save', String(trackId), 'ok', `${capped.length} hot cue`);
      return { saved: capped.length };
    }
  );

  // ---- auto-tagger (Fase 2.4): solo query testuali, mai upload audio ----
  ipcMain.handle('tagger:propose', async (_e, limit?: number, provider?: TagProvider) => {
    const progress = new ThrottledProgress(win().webContents);
    const jobId = randomUUID();
    try {
      const r = await proposeTags(db, {
        limit,
        provider,
        discogsToken: getSetting(db, 'discogsToken') ?? undefined,
        onProgress: (done, total) => progress.update({ jobId, phase: 'tagger', done, total })
      });
      progress.finish({ jobId, phase: 'tagger', done: 1, total: 1 });
      logOperation(
        db,
        'tagger.propose',
        provider ?? 'musicbrainz',
        'dry-run',
        `${r.proposals.length} proposte su ${r.queried} brani`
      );
      return { ok: true, ...r };
    } catch (err) {
      progress.finish({ jobId, phase: 'tagger', done: 1, total: 1 });
      logOperation(db, 'tagger.propose', null, 'error', String(err));
      return { ok: false, message: String(err) };
    }
  });

  // target 'udm' (default, sicuro) oppure 'original': scrittura ID3 sui file
  // originali via sidecar mutagen, con backup+hash+rollback. Gate nel main.
  ipcMain.handle(
    'tagger:apply',
    async (_e, proposals: TagProposal[], target: 'udm' | 'original' = 'udm') => {
      if (target === 'udm') return { ...applyProposals(db, proposals), target: 'udm' };

      if (getSetting(db, 'directWrites') !== '1') {
        throw new Error(
          'Le scritture dirette sono disattivate. Attivale in Impostazioni → Esperto.'
        );
      }
      const check = checkSidecar();
      if (!check.available) {
        return { ok: false, target: 'original', message: 'Modulo sidecar non disponibile.' };
      }
      // Raggruppa le proposte per file (il path viene dall'UDM).
      const pathStmt = db.prepare(`SELECT path FROM tracks WHERE id = ?`);
      const byTrack = new Map<number, { path: string; tags: Record<string, string> }>();
      for (const p of proposals) {
        const row = pathStmt.get(p.trackId) as { path: string | null } | undefined;
        if (!row?.path) continue;
        const entry = byTrack.get(p.trackId) ?? { path: row.path, tags: {} };
        entry.tags[p.field] = p.proposed;
        byTrack.set(p.trackId, entry);
      }
      const jobs = [...byTrack.values()];
      const backupDir = join(
        app.getPath('userData'),
        'backups',
        `id3-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
      );
      const r = await runSidecarJob('write-tags', 'write-tags', [
        '--tags-json',
        JSON.stringify(jobs),
        '--backup-dir',
        backupDir
      ]);
      if (!r.ok) {
        logOperation(db, 'tagger.apply.original', null, 'error', r.message);
        return { ok: false, target: 'original', message: r.message };
      }
      // Aggiorna anche l'UDM così la libreria interna resta allineata.
      applyProposals(db, proposals);
      logOperation(
        db,
        'tagger.apply.original',
        backupDir,
        'ok',
        `SCRITTURA SU ORIGINALI: ${(r.data as { written?: number })?.written ?? 0} file, backup in ${backupDir}`
      );
      return { ok: true, target: 'original', ...r.data, backupDir };
    }
  );

  // ---- stems (Fase 2.5, opzionale e pesante) ----
  ipcMain.handle('stems:run', async (_e, trackId: number, outDir: string) => {
    const t = db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(trackId) as
      | { path: string | null }
      | undefined;
    if (!t?.path) return { ok: false, message: 'Brano senza percorso file.' };
    const r = await runSidecarJob('stems', 'stems', ['--file', t.path, '--out-dir', outDir]);
    logOperation(db, 'stems.run', t.path, r.ok ? 'ok' : 'error', r.ok ? outDir : r.message);
    return r;
  });

  // =====================================================================
  // FASE 3 — power user (modalità Esperto)
  // =====================================================================

  // ---- Sync Daemon "Nuovi Acquisti" (§6 Fase 3.1) ----
  // Attivo solo mentre l'app è aperta (la UI lo dichiara). Nuovi item →
  // notifica leggera al renderer (solo il conteggio, mai bulk data).
  const daemon = new SyncDaemon(db, undefined, (added) => {
    win()?.webContents.send('inbox:new-items', { added });
  });

  ipcMain.handle('watcher:start', async (_e, folder: string) => {
    const r = await daemon.start(folder);
    setSetting(db, 'watchFolder', folder);
    setSetting(db, 'watchEnabled', '1');
    return r;
  });
  ipcMain.handle('watcher:stop', () => {
    daemon.stop();
    setSetting(db, 'watchEnabled', '0');
    logOperation(db, 'watch.stop', getSetting(db, 'watchFolder'), 'ok');
    return true;
  });
  ipcMain.handle('watcher:status', () => daemon.status());
  ipcMain.handle('watcher:scan', async (_e, folder: string) => daemon.scanOnce(folder));

  // Riavvio automatico del daemon se era attivo nella sessione precedente.
  if (getSetting(db, 'watchEnabled') === '1') {
    const saved = getSetting(db, 'watchFolder');
    if (saved) daemon.start(saved).catch(() => setSetting(db, 'watchEnabled', '0'));
  }

  ipcMain.handle('inbox:list', (_e, status?: 'new' | 'prepared' | 'dismissed') =>
    listInbox(db, status ?? 'new')
  );
  ipcMain.handle(
    'inbox:setStatus',
    (_e, ids: number[], status: 'new' | 'prepared' | 'dismissed') => {
      const n = setInboxStatus(db, ids, status);
      logOperation(db, 'inbox.status', null, 'ok', `${n} item → ${status}`);
      return n;
    }
  );
  ipcMain.handle('inbox:prepareXml', (_e, ids: number[], outPath: string) => {
    const all = listInbox(db, 'new', 2000);
    const chosen = all.filter((i) => ids.includes(i.id) && i.has_tag_issues === 0);
    const r = writeInboxXml(chosen, outPath);
    setInboxStatus(db, chosen.map((i) => i.id), 'prepared');
    logOperation(db, 'inbox.xml', outPath, 'ok', `${r.written} nuovi brani nell'XML`);
    return { ...r, excludedForIssues: ids.length - chosen.length };
  });

  // ---- Salute libreria (read-only, modalità Semplice) ----
  ipcMain.handle('health:get', () => computeHealth(db));

  // ---- Set Builder (Esperto, read-only; export = solito XML manuale) ----
  ipcMain.handle(
    'setbuilder:build',
    (_e, startTrackId: number, length: number, curve: BpmCurve) =>
      buildSet(db, startTrackId, length, curve)
  );
  ipcMain.handle(
    'setbuilder:exportXml',
    (_e, trackIds: number[], playlistName: string, outPath: string) => {
      const r = writeSetXml(db, trackIds, playlistName, outPath);
      logOperation(db, 'setbuilder.xml', outPath, 'ok', `${r.written} brani in "${playlistName}"`);
      return r;
    }
  );

  // ---- Scrittura DIRETTA nel master.db (opt-in massimo, Rekordbox chiuso) ----
  // La cifratura SQLCipher è documentata (chiave fissa nota); pyrekordbox
  // scrive e ri-cifra gestendo l'USN. Gate: setting masterDbWrites nel main.
  // Node copia (byte, sola lettura sul sorgente) master.db+options.json in un
  // backup datato PRIMA di qualsiasi scrittura (§3.2).
  ipcMain.handle(
    'masterdb:createPlaylist',
    async (
      _e,
      trackIds: number[],
      playlistName: string,
      masterDbPath: string,
      optionsJsonPath: string | null
    ) => {
      if (getSetting(db, 'masterDbWrites') !== '1') {
        throw new Error(
          'La scrittura diretta nel database di Rekordbox è disattivata. ' +
            'Attivala in Impostazioni → Esperto (con tutti gli avvisi del caso).'
        );
      }
      const check = checkSidecar();
      if (!check.available) {
        return { ok: false, message: 'Il modulo di lettura/scrittura non è disponibile.' };
      }
      // Risolvi gli ID contenuto del master.db dai brani UDM (source_id).
      const idStmt = db.prepare(`SELECT source_id FROM tracks WHERE id = ?`);
      const contentIds = trackIds
        .map((id) => (idStmt.get(id) as { source_id: string | null } | undefined)?.source_id)
        .filter((s): s is string => !!s);
      if (contentIds.length === 0) {
        return {
          ok: false,
          message:
            'Nessuno dei brani selezionati ha un identificativo del database Rekordbox ' +
            '(serve una libreria importata da master.db, non da XML).'
        };
      }

      // Backup obbligatorio PRIMA di scrivere (§3.2).
      const backupDir = join(
        app.getPath('userData'),
        'backups',
        `masterdb-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
      );
      try {
        mkdirSync(backupDir, { recursive: true });
        copyFileSync(masterDbPath, join(backupDir, basename(masterDbPath)));
        if (optionsJsonPath) copyFileSync(optionsJsonPath, join(backupDir, basename(optionsJsonPath)));
      } catch (err) {
        logOperation(db, 'masterdb.backup', backupDir, 'error', String(err));
        return { ok: false, message: `Backup del database non riuscito, scrittura annullata: ${String(err)}` };
      }
      logOperation(db, 'masterdb.backup', backupDir, 'ok', `${basename(masterDbPath)} + options.json`);

      const r = await runSidecarJob('masterdb-create-playlist', 'masterdb-playlist', [
        '--master-db',
        masterDbPath,
        '--playlist-name',
        playlistName,
        '--content-ids-json',
        JSON.stringify(contentIds)
      ]);
      if (!r.ok) {
        logOperation(db, 'masterdb.createPlaylist', masterDbPath, 'error', r.message);
        return { ok: false, message: r.message, backupDir };
      }
      logOperation(
        db,
        'masterdb.createPlaylist',
        masterDbPath,
        'ok',
        `SCRITTURA DIRETTA: playlist "${playlistName}", ${JSON.stringify(r.data)}`
      );
      return { ok: true, ...r.data, backupDir, requested: trackIds.length };
    }
  );

  // ---- Set Planner (§6 Fase 3.2, read-only) ----
  ipcMain.handle('planner:playlists', () => listPlaylists(db));
  ipcMain.handle('planner:analyze', (_e, playlistId: number) => {
    const r = analyzePlaylist(db, playlistId);
    logOperation(
      db,
      'planner.analyze',
      String(playlistId),
      'ok',
      `${r.transitions.length} transizioni, ${r.problems} problematiche`
    );
    return r;
  });

  // ---- dialoghi file ----
  ipcMain.handle('dialog:openFile', async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:openDirectory', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, filters?: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showSaveDialog(win(), { defaultPath: defaultName, filters });
    return r.canceled ? null : r.filePath;
  });
}
