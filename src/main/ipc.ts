import { BrowserWindow, dialog, ipcMain } from 'electron';
import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { getSetting, getTracksPage, logOperation, setSetting } from '@core/udm';
import { ingestCollectionXml } from '@core/xmlCollection';
import { executeBackup, planBackup, BackupOptions, BackupPlan } from '@services/backup/incrementalBackup';
import { findOrphans, quarantineOrphans } from '@services/orphans/orphanFinder';
import { generateExcelReport } from '@services/excel/reportGenerator';
import { findBrokenTracks, matchByFilename, RelocationMatch } from '@services/relocator/relocator';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { REKORDBOX_XML_LIMITS } from '@adapters/common';
import { SERATO_STATUS } from '@adapters/serato';
import { ENGINE_STATUS } from '@adapters/engine';
import { ThrottledProgress } from './progress';
import { checkSidecar, runSidecar } from './sidecar';

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
  ipcMain.handle('export:limits', () => ({
    rekordboxXml: REKORDBOX_XML_LIMITS,
    serato: SERATO_STATUS,
    engine: ENGINE_STATUS
  }));

  // ---- libreria (paginata) ----
  ipcMain.handle('library:page', (_e, q) => getTracksPage(db, q));
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
              ' Puoi usare la modalità solo-XML: esporta la collection da Rekordbox e importala qui.'
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
