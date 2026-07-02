import type BetterSqlite3 from 'better-sqlite3';
import { mkdir, rename } from 'fs/promises';
import { basename, join, normalize } from 'path';
import { AUDIO_EXTENSIONS, walkFiles } from '../fsutil';
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

function canon(p: string): string {
  return normalize(p).toLowerCase();
}

export async function findOrphans(
  db: BetterSqlite3.Database,
  musicDir: string,
  onProgress?: (scanned: number) => void
): Promise<OrphanScanResult> {
  // Path noti dal DB: set in RAM di sole stringhe (decine di MB max, non oggetti).
  const known = new Set<string>();
  for (const row of db.prepare(`SELECT path FROM tracks WHERE path IS NOT NULL`).iterate()) {
    known.add(canon((row as { path: string }).path));
  }

  const orphans: OrphanFile[] = [];
  let scanned = 0;
  let reclaimable = 0;
  for await (const file of walkFiles(musicDir, AUDIO_EXTENSIONS)) {
    scanned++;
    if (!known.has(canon(file.path))) {
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
      let dest = join(quarantineDir, basename(f));
      let n = 1;
      while (n < 1000) {
        try {
          await rename(f, dest);
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
            dest = join(quarantineDir, `${n++}_${basename(f)}`);
          } else if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
            // volume diverso: copia + elimina non è "move" atomico → rifiuta, più sicuro
            throw new Error('File su un volume diverso dalla quarantena: operazione saltata');
          } else {
            throw err;
          }
        }
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
