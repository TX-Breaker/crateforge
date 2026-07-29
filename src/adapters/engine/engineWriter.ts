import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  defaultTrailer,
  encodeLoops,
  encodeQuickCues,
  encodeTrackData,
  ENGINE_PAD_COLORS,
  ENGINE_SLOTS,
  frameZlib,
  msToSamples,
  type EngineLoopSlot
} from './engineCodec';
import { getCuesForTrack, iterateTracks, type ExportSelection } from '../common';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Export verso Engine DJ: genera una Engine Library NUOVA.
 *
 * Perché una libreria nuova e non una modifica di quella esistente: il
 * database di Engine contiene blob che sappiamo leggere ma non ricreare in
 * tutte le loro parti (la forma d'onda, la griglia dei beat, alcuni campi di
 * `trackData` restano inspiegati). Riscrivere il database dell'utente
 * significherebbe rischiare quei dati; generarne uno nuovo, che l'utente apre
 * quando vuole, non tocca nulla di suo.
 *
 * Lo schema NON è incorporato nel codice: viene copiato da un m.db esistente
 * indicato dall'utente. Così la libreria generata ha esattamente la versione
 * di schema della sua installazione, invece di una nostra ipotesi che una
 * versione futura di Engine potrebbe rifiutare.
 *
 * Quello che scriviamo (misurato e verificato byte-per-byte): metadati del
 * brano, hot cue e loop. Quello che NON scriviamo, e che Engine ricalcola alla
 * prima analisi: forma d'onda, griglia dei beat, key analizzata.
 */

export interface EngineExportResult {
  tracks: number;
  cues: number;
  loops: number;
  dbPath: string;
  warnings: string[];
}

/** Colonne di Track che valorizziamo (le altre restano al default dello schema). */
const TRACK_COLUMNS = [
  'playOrder',
  'length',
  'bpm',
  'year',
  'path',
  'filename',
  'bitrate',
  'bpmAnalyzed',
  'albumArtId',
  'fileBytes',
  'title',
  'artist',
  'album',
  'genre',
  'comment',
  'label',
  'composer',
  'isAnalyzed',
  'dateCreated',
  'explicitLyrics',
  'timeLastPlayed',
  'isPlayed',
  'fileType',
  'isAvailable',
  'isMetadataOfPackedTrackChanged',
  'isPerfomanceDataOfPackedTrackChanged',
  'playedIndicator',
  'isMetadataImported',
  'streamingFlags',
  'explicitLyrics'
] as const;

/**
 * Path Engine: relativo alla cartella che contiene "Engine Library", con
 * separatori POSIX.
 *
 * I ".." sono legittimi e Engine li usa davvero (nella libreria reale di
 * riferimento i path sono del tipo "../../Desktop/…"): quello che invece NON è
 * rappresentabile è un brano su un ALTRO disco, perché lì `relative` non può
 * produrre un percorso relativo e restituisce un assoluto. In quel caso la
 * traccia viene saltata con un avviso, invece di scrivere un riferimento rotto.
 */
function enginePath(trackPath: string, libraryRoot: string): string | null {
  const rel = relative(libraryRoot, trackPath);
  if (!rel || /^[a-z]:/i.test(rel)) return null;
  return rel.split(sep).join('/');
}

export function writeEngineLibrary(
  db: BetterSqlite3.Database,
  outDir: string,
  templateDbPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): EngineExportResult {
  const warnings: string[] = [];
  if (!existsSync(templateDbPath)) {
    throw new Error(
      'Serve un m.db di Engine esistente come modello dello schema: indica quello della tua installazione.'
    );
  }

  // 1) Schema copiato dall'installazione dell'utente (stessa versione).
  const template = new Database(templateDbPath, { readonly: true });
  const ddl = template
    .prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
    .all() as { sql: string }[];
  const info = template.prepare('SELECT * FROM Information LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  const trackCols = new Set(
    (template.prepare('PRAGMA table_info(Track)').all() as { name: string }[]).map((c) => c.name)
  );
  template.close();

  const dbDir = join(outDir, 'Engine Library', 'Database2');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'm.db');
  if (existsSync(dbPath)) {
    throw new Error(`Esiste già una libreria Engine in ${dbDir}: scegli un'altra cartella.`);
  }

  const out = new Database(dbPath);
  out.pragma('journal_mode = delete'); // come Engine: nessun file -wal/-shm
  let written = 0;
  let cueCount = 0;
  let loopCount = 0;

  try {
    for (const stmt of ddl) {
      out.exec(stmt.sql);
    }
    // Information: copiamo la riga del modello così la versione di schema
    // dichiarata corrisponde a quella delle strutture che abbiamo creato.
    if (info) {
      const cols = Object.keys(info);
      out
        .prepare(
          `INSERT INTO Information (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        )
        .run(...cols.map((c) => info[c] as never));
    }

    const usable = TRACK_COLUMNS.filter((c) => trackCols.has(c));
    const insertTrack = out.prepare(
      `INSERT INTO Track (${usable.join(',')}) VALUES (${usable.map(() => '?').join(',')})`
    );
    const insertPerf = out.prepare(
      `INSERT INTO PerformanceData (trackId, trackData, quickCues, loops)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(trackId) DO UPDATE SET
         trackData = excluded.trackData,
         quickCues = excluded.quickCues,
         loops = excluded.loops`
    );

    const run = out.transaction(() => {
      for (const t of iterateTracks(db, sel)) {
        if (!t.path) continue;
        const rel = enginePath(t.path, outDir);
        if (!rel) {
          warnings.push(`"${t.title ?? t.path}" è su un altro disco rispetto alla libreria: saltato.`);
          continue;
        }
        const filename = t.path.split(/[\\/]/).pop() ?? '';
        const values: Record<string, unknown> = {
          playOrder: written + 1,
          length: t.duration_s !== null ? Math.round(t.duration_s) : null,
          bpm: t.bpm !== null ? Math.round(t.bpm) : null,
          year: t.year,
          path: rel,
          filename,
          bitrate: null,
          bpmAnalyzed: t.bpm,
          // NULL e non 0: albumArtId ha una foreign key su AlbumArt(id) e lo
          // zero non corrisponde ad alcuna riga. La copertina la rigenera
          // Engine dai tag del file.
          albumArtId: null,
          fileBytes: t.filesize,
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
          comment: null,
          label: null,
          composer: null,
          // 0 = da analizzare: Engine ricostruisce forma d'onda e griglia.
          isAnalyzed: 0,
          dateCreated: null,
          explicitLyrics: 0,
          timeLastPlayed: null,
          isPlayed: 0,
          fileType: (filename.split('.').pop() ?? '').toLowerCase(),
          isAvailable: 1,
          isMetadataOfPackedTrackChanged: 0,
          isPerfomanceDataOfPackedTrackChanged: 0,
          playedIndicator: 0,
          isMetadataImported: 1,
          streamingFlags: 0
        };
        const trackId = Number(insertTrack.run(...usable.map((c) => values[c] as never)).lastInsertRowid);

        // Cue e loop: gli 8 pad di Engine.
        const sampleRate = 44100; // ricalcolata da Engine all'analisi
        const cues = getCuesForTrack(db, t.id);
        const slots: ({ label: string; positionSamples: number; color: string } | null)[] = new Array(
          ENGINE_SLOTS
        ).fill(null);
        const loopSlots: (EngineLoopSlot | null)[] = new Array(ENGINE_SLOTS).fill(null);
        let nextFreeCue = 0;
        let nextFreeLoop = 0;
        for (const c of cues) {
          if (c.cue_type === 'loop' && c.length_ms !== null) {
            const idx = c.cue_index !== null && c.cue_index < ENGINE_SLOTS ? c.cue_index : nextFreeLoop;
            if (idx >= ENGINE_SLOTS || loopSlots[idx]) continue;
            loopSlots[idx] = {
              label: c.label ?? `Loop ${idx + 1}`,
              startSamples: msToSamples(c.position_ms, sampleRate),
              endSamples: msToSamples(c.position_ms + c.length_ms, sampleRate),
              color: c.color ?? ENGINE_PAD_COLORS[idx]
            };
            nextFreeLoop = Math.max(nextFreeLoop, idx + 1);
            loopCount++;
          } else if (c.cue_type === 'hot' || c.cue_type === 'memory') {
            const idx = c.cue_index !== null && c.cue_index < ENGINE_SLOTS ? c.cue_index : nextFreeCue;
            if (idx >= ENGINE_SLOTS || slots[idx]) continue;
            slots[idx] = {
              label: c.label ?? `Cue ${idx + 1}`,
              positionSamples: msToSamples(c.position_ms, sampleRate),
              color: c.color ?? ENGINE_PAD_COLORS[idx]
            };
            nextFreeCue = Math.max(nextFreeCue, idx + 1);
            cueCount++;
          }
        }

        const totalSamples = t.duration_s !== null ? t.duration_s * sampleRate : 0;
        insertPerf.run(
          trackId,
          frameZlib(encodeTrackData(sampleRate, totalSamples)),
          frameZlib(encodeQuickCues({ slots, trailer: defaultTrailer() })),
          encodeLoops(loopSlots) // i loop NON sono compressi
        );
        written++;
        if (written % 200 === 0) onProgress?.(written);
      }
    });
    run();
  } finally {
    out.close();
  }

  if (cueCount === 0 && loopCount === 0) {
    warnings.push('Nessun cue o loop da esportare: la libreria conterrà solo i brani.');
  }
  warnings.push(
    'Engine ricalcola forma d\'onda e griglia dei beat alla prima analisi: apri la libreria e lascia analizzare i brani.'
  );
  return { tracks: written, cues: cueCount, loops: loopCount, dbPath, warnings };
}
