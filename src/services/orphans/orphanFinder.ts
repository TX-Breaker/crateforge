import type BetterSqlite3 from 'better-sqlite3';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import { AUDIO_EXTENSIONS, canonicalizePath, walkFiles } from '../fsutil';
import { logOperation } from '@core/udm';

/**
 * Cacciatore di File Orfani (§6 Fase 1.2): file audio su disco ma assenti
 * dal DB Rekordbox (via UDM). Solo diff + anteprima; l'azione vera passa da
 * doppia conferma UI e NON cancella mai definitivamente da sola: sposta in
 * una cartella di quarantena dell'app, reversibile.
 */

export interface OrphanFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface OrphanScanResult {
  orphans: OrphanFile[];
  scannedFiles: number;
  knownTracks: number;
  reclaimableBytes: number;
}

export async function findOrphans(
  db: BetterSqlite3.Database,
  musicDir: string,
  onProgress?: (scanned: number) => void
): Promise<OrphanScanResult> {
  // Path noti dal DB: set in RAM di sole stringhe (decine di MB max, non oggetti).
  // canonicalizePath normalizza a NFC: senza, i brani con accenti su macOS
  // (disco NFD vs DB NFC) sarebbero tutti falsi orfani → rischio cancellazione.
  const known = new Set<string>();
  for (const row of db.prepare(`SELECT path FROM tracks WHERE path IS NOT NULL`).iterate()) {
    known.add(canonicalizePath((row as { path: string }).path));
  }

  const orphans: OrphanFile[] = [];
  let scanned = 0;
  let reclaimable = 0;
  for await (const file of walkFiles(musicDir, AUDIO_EXTENSIONS)) {
    scanned++;
    if (!known.has(canonicalizePath(file.path))) {
      orphans.push({ path: file.path, size: file.size, mtimeMs: file.mtimeMs });
      reclaimable += file.size;
    }
    if (scanned % 200 === 0) onProgress?.(scanned);
  }

  return {
    orphans,
    scannedFiles: scanned,
    knownTracks: known.size,
    reclaimableBytes: reclaimable
  };
}

export interface QuarantineResult {
  moved: number;
  failed: { path: string; error: string }[];
  quarantineDir: string;
}

/**
 * Sposta gli orfani selezionati nella cartella di quarantena dell'app.
 * Reversibile: nessuna cancellazione definitiva qui.
 */
export async function quarantineOrphans(
  db: BetterSqlite3.Database,
  files: string[],
  quarantineRoot: string,
  dryRun: boolean
): Promise<QuarantineResult> {
  const quarantineDir = join(quarantineRoot, new Date().toISOString().slice(0, 10));
  const failed: QuarantineResult['failed'] = [];
  let moved = 0;

  if (dryRun) {
    logOperation(db, 'orphans.quarantine', quarantineDir, 'dry-run', `${files.length} file`);
    return { moved: files.length, failed, quarantineDir };
  }

  await mkdir(quarantineDir, { recursive: true });
  for (const f of files) {
    try {
      // Trova un dest LIBERO prima di spostare: `rename` sovrascrive la
      // destinazione, quindi due orfani con lo stesso nome file si
      // distruggerebbero a vicenda (il ramo EEXIST non scatta sul rename).
      let dest = join(quarantineDir, basename(f));
      let n = 1;
      while (existsSync(dest)) {
        if (n >= 1000) throw new Error('Troppi file omonimi in quarantena: operazione saltata');
        dest = join(quarantineDir, `${n++}_${basename(f)}`);
      }
      try {
        await rename(f, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          // volume diverso: copia + elimina non è "move" atomico → rifiuta, più sicuro
          throw new Error('File su un volume diverso dalla quarantena: operazione saltata');
        }
        throw err;
      }
      moved++;
      logOperation(db, 'orphans.quarantine', f, 'ok', `→ ${dest}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ path: f, error: msg });
      logOperation(db, 'orphans.quarantine', f, 'error', msg);
    }
  }
  return { moved, failed, quarantineDir };
}

export interface DeleteResult {
  deleted: number;
  freedBytes: number;
  failed: { path: string; error: string }[];
}

/**
 * Eliminazione DEFINITIVA degli orfani (fase intermedia, opt-in "scritture
 * dirette"). Irreversibile per design: la UI la sblocca solo con il setting
 * dedicato attivo e doppia conferma "ELIMINA". La quarantena resta la strada
 * consigliata.
 */
export async function deleteOrphans(
  db: BetterSqlite3.Database,
  files: string[],
  dryRun: boolean
): Promise<DeleteResult> {
  const failed: DeleteResult['failed'] = [];
  let deleted = 0;
  let freedBytes = 0;

  if (dryRun) {
    for (const f of files) {
      try {
        freedBytes += (await stat(f)).size;
      } catch {
        // file già assente: non conta
      }
    }
    logOperation(db, 'orphans.delete', null, 'dry-run', `${files.length} file, ${freedBytes} byte`);
    return { deleted: files.length, freedBytes, failed };
  }

  for (const f of files) {
    try {
      const size = (await stat(f)).size;
      await rm(f);
      deleted++;
      freedBytes += size;
      logOperation(db, 'orphans.delete', f, 'ok', 'ELIMINATO DEFINITIVAMENTE (scritture dirette)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ path: f, error: msg });
      logOperation(db, 'orphans.delete', f, 'error', msg);
    }
  }
  return { deleted, freedBytes, failed };
}
