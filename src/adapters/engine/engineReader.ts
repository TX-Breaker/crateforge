import Database from 'better-sqlite3';
import { dirname, join, resolve } from 'path';
import type { ForeignLibrary, NormPlaylist, NormTrack } from '@core/foreignImport';

/**
 * Reader Engine DJ (Denon / Engine Prime / Engine OS).
 * L'Engine Library è un database SQLite IN CHIARO (non cifrato): lo apriamo in
 * sola lettura con better-sqlite3. Lo schema cambia parecchio tra versioni,
 * quindi il reader è difensivo: introspeziona le colonne di Track e usa solo
 * quelle presenti. I cue/loop sono blob impacchettati (PerformanceData) e per
 * ora NON vengono importati (avviso). Le playlist sì, se presenti.
 *
 * Percorso tipico del db: "<drive>/Engine Library/Database2/m.db".
 */

// Engine memorizza la key come intero 0..23 (0=C … 11=B maggiori, 12..23 minori).
const ENGINE_KEY: Record<number, string> = {
  0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F', 6: 'F#', 7: 'G',
  8: 'G#', 9: 'A', 10: 'A#', 11: 'B',
  12: 'Cm', 13: 'C#m', 14: 'Dm', 15: 'D#m', 16: 'Em', 17: 'Fm',
  18: 'F#m', 19: 'Gm', 20: 'G#m', 21: 'Am', 22: 'A#m', 23: 'Bm'
};

function columnsOf(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
}

/** Prima colonna esistente tra i candidati, o null. */
function pick(cols: Set<string>, ...cands: string[]): string | null {
  for (const c of cands) if (cols.has(c)) return c;
  return null;
}

export function readEngineLibrary(dbPath: string): ForeignLibrary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const warnings: string[] = [];
  try {
    if (!tableExists(db, 'Track')) {
      throw new Error('Non sembra un Engine Library: manca la tabella Track.');
    }
    const cols = columnsOf(db, 'Track');
    const c = {
      id: pick(cols, 'id', 'originId') ?? 'id',
      title: pick(cols, 'title'),
      artist: pick(cols, 'artist'),
      album: pick(cols, 'album'),
      genre: pick(cols, 'genre'),
      year: pick(cols, 'year'),
      bpm: pick(cols, 'bpmAnalyzed', 'bpm'),
      key: pick(cols, 'keyAnalyzed', 'key'),
      length: pick(cols, 'length', 'lengthCalculated'),
      path: pick(cols, 'path', 'filename'),
      filename: pick(cols, 'filename'),
      filesize: pick(cols, 'fileBytes', 'size')
    };

    const sel = [
      `${c.id} AS id`,
      c.title ? `${c.title} AS title` : `NULL AS title`,
      c.artist ? `${c.artist} AS artist` : `NULL AS artist`,
      c.album ? `${c.album} AS album` : `NULL AS album`,
      c.genre ? `${c.genre} AS genre` : `NULL AS genre`,
      c.year ? `${c.year} AS year` : `NULL AS year`,
      c.bpm ? `${c.bpm} AS bpm` : `NULL AS bpm`,
      c.key ? `${c.key} AS keyval` : `NULL AS keyval`,
      c.length ? `${c.length} AS length` : `NULL AS length`,
      c.path ? `${c.path} AS path` : `NULL AS path`,
      c.filesize ? `${c.filesize} AS filesize` : `NULL AS filesize`
    ].join(', ');

    const rows = db.prepare(`SELECT ${sel} FROM Track`).all() as Record<string, unknown>[];
    const libRoot = resolve(dirname(dbPath), '..', '..'); // …/Engine Library/Database2/m.db → drive root

    const tracks: NormTrack[] = rows.map((r) => {
      const rawPath = r.path != null ? String(r.path) : null;
      // I path Engine sono spesso relativi al drive: prova a renderli assoluti.
      const path = rawPath
        ? rawPath.match(/^([A-Za-z]:|\/|\\\\)/)
          ? rawPath
          : join(libRoot, rawPath.replace(/^\.\.?[\\/]/, ''))
        : null;
      const keyval = r.keyval != null ? Number(r.keyval) : NaN;
      const musicalKey = Number.isInteger(keyval) && ENGINE_KEY[keyval] ? ENGINE_KEY[keyval] : null;
      const bpm = r.bpm != null ? Number(r.bpm) || null : null;
      return {
        sourceId: String(r.id),
        title: r.title != null ? String(r.title) : null,
        artist: r.artist != null ? String(r.artist) : null,
        album: r.album != null ? String(r.album) : null,
        genre: r.genre != null ? String(r.genre) : null,
        year: r.year != null ? Number(r.year) || null : null,
        bpm: bpm && bpm > 0 ? bpm : null,
        musicalKey,
        durationS: r.length != null ? Number(r.length) || null : null,
        path,
        filesize: r.filesize != null ? Number(r.filesize) || null : null,
        cues: []
      };
    });

    // Playlist (se presenti). Schema comune: Playlist(id,title[,parentListId]),
    // PlaylistEntity(listId,trackId[,nextEntityId]).
    const playlists: NormPlaylist[] = [];
    if (tableExists(db, 'Playlist') && tableExists(db, 'PlaylistEntity')) {
      const plCols = columnsOf(db, 'Playlist');
      const titleCol = pick(plCols, 'title', 'name') ?? 'title';
      const parentCol = pick(plCols, 'parentListId', 'parentId');
      const peCols = columnsOf(db, 'PlaylistEntity');
      const trackCol = pick(peCols, 'trackId', 'databaseUuidTrackId') ?? 'trackId';
      // Engine ordina le entity con una lista concatenata (nextEntityId, 0 = fine).
      const hasChain = peCols.has('nextEntityId') && peCols.has('id');

      const pls = db
        .prepare(`SELECT id, ${titleCol} AS title${parentCol ? `, ${parentCol} AS parent` : ''} FROM Playlist`)
        .all() as { id: number; title: string; parent?: number }[];
      for (const p of pls) {
        let trackSourceIds: string[];
        if (hasChain) {
          const rows = db
            .prepare(`SELECT id, ${trackCol} AS trackId, nextEntityId AS next FROM PlaylistEntity WHERE listId = ?`)
            .all(p.id) as { id: number; trackId: number; next: number }[];
          // Testa = entity non referenziata da nessun `next`; poi segui la catena.
          const referenced = new Set(rows.map((r) => r.next).filter((n) => n));
          const byId = new Map(rows.map((r) => [r.id, r]));
          let head = rows.find((r) => !referenced.has(r.id));
          const ordered: string[] = [];
          const seen = new Set<number>();
          while (head && !seen.has(head.id)) {
            seen.add(head.id);
            ordered.push(String(head.trackId));
            head = head.next ? byId.get(head.next) : undefined;
          }
          // Se la catena è rotta/incompleta, aggiungi il resto per rowid.
          trackSourceIds =
            ordered.length === rows.length
              ? ordered
              : [...ordered, ...rows.filter((r) => !seen.has(r.id)).map((r) => String(r.trackId))];
        } else {
          const rows = db
            .prepare(`SELECT ${trackCol} AS trackId FROM PlaylistEntity WHERE listId = ? ORDER BY rowid`)
            .all(p.id) as { trackId: number }[];
          trackSourceIds = rows.map((r) => String(r.trackId));
        }
        playlists.push({
          sourceId: String(p.id),
          name: p.title ?? 'Senza nome',
          isFolder: false,
          parentSourceId: p.parent ? String(p.parent) : null,
          trackSourceIds
        });
      }
    }

    warnings.push('Engine DJ: cue e loop (blob PerformanceData) non ancora importati; importati brani, BPM, key e playlist.');
    if (tracks.length === 0) warnings.push('Nessun brano trovato nel database Engine.');
    return { source: 'engine', tracks, playlists, warnings };
  } finally {
    db.close();
  }
}
