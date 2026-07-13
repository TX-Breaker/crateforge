import type BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'fs';
import { basename } from 'path';
import { AUDIO_EXTENSIONS, canonicalizeName, walkFiles } from '../fsutil';
import type { TrackRow } from '@core/udm';

/**
 * Relocator Esterno base (§6 Fase 1.5): trova i path rotti, matcha per nome
 * file nella nuova cartella e prepara i dati per un XML di aggiornamento da
 * re-importare in Rekordbox. MAI scrivere il nuovo path nel master.db.
 * (Il matching per fingerprint arriva in Fase 2.)
 */

export interface BrokenTrack {
  track: TrackRow;
  oldPath: string;
}

export interface RelocationMatch {
  track: TrackRow;
  oldPath: string;
  newPath: string | null; // null = nessun match trovato
  ambiguous: string[]; // altri candidati con lo stesso nome
}

export function findBrokenTracks(
  db: BetterSqlite3.Database,
  onProgress?: (checked: number, total: number) => void
): BrokenTrack[] {
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks WHERE path IS NOT NULL`).get() as { c: number }
  ).c;
  const broken: BrokenTrack[] = [];
  let checked = 0;
  for (const row of db
    .prepare(`SELECT * FROM tracks WHERE path IS NOT NULL`)
    .iterate() as IterableIterator<TrackRow>) {
    checked++;
    if (row.path && !existsSync(row.path)) {
      broken.push({ track: row, oldPath: row.path });
    }
    if (checked % 500 === 0) onProgress?.(checked, total);
  }
  return broken;
}

export async function matchByFilename(
  broken: BrokenTrack[],
  newRoot: string,
  onProgress?: (scanned: number) => void
): Promise<RelocationMatch[]> {
  // Indice nome-file → path[] della nuova cartella
  const byName = new Map<string, string[]>();
  let scanned = 0;
  for await (const file of walkFiles(newRoot, AUDIO_EXTENSIONS)) {
    scanned++;
    const name = canonicalizeName(basename(file.path));
    const list = byName.get(name);
    if (list) list.push(file.path);
    else byName.set(name, [file.path]);
    if (scanned % 200 === 0) onProgress?.(scanned);
  }

  return broken.map(({ track, oldPath }) => {
    const candidates = byName.get(canonicalizeName(basename(oldPath))) ?? [];
    return {
      track,
      oldPath,
      newPath: candidates[0] ?? null,
      ambiguous: candidates.slice(1)
    };
  });
}
