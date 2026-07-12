import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import type { ForeignLibrary, NormCue, NormPlaylist, NormTrack } from '@core/foreignImport';

/**
 * Reader Traktor NML (collection.nml) → modello normalizzato.
 * È l'inverso di adapters/traktor/nmlWriter.ts e gestisce i file reali di
 * Traktor Pro. Rende la conversione Traktor → (UDM) → Rekordbox/altri.
 *
 * Solo lettura: non tocca mai il file di origine.
 */

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** VOLUME "C:" + DIR "/:Music/:House/:" + FILE "a.mp3" → C:\Music\House\a.mp3. */
export function traktorLocationToPath(
  volume: string | undefined,
  dir: string | undefined,
  file: string | undefined
): string | null {
  if (!file) return null;
  const parts = (dir ?? '')
    .split('/:')
    .map((s) => s.replace(/^\/+/, ''))
    .filter(Boolean);
  const vol = volume ?? '';
  if (/^[A-Za-z]:$/.test(vol)) {
    // Windows
    return `${vol}\\${[...parts, file].join('\\')}`;
  }
  // macOS/Linux: percorso assoluto
  return `/${[...parts, file].join('/')}`;
}

// CUE_V2 TYPE: 0=cue, 1=fade-in, 2=fade-out, 3=load, 4=grid, 5=loop.
function mapCue(c: Record<string, string>): NormCue | null {
  const start = Number(c['@_START']);
  if (Number.isNaN(start)) return null;
  const len = c['@_LEN'] !== undefined ? Number(c['@_LEN']) : 0;
  const hotcue = c['@_HOTCUE'] !== undefined ? Number(c['@_HOTCUE']) : -1;
  const type = c['@_TYPE'];
  if (type === '4') return null; // grid marker: è la beatgrid, non un cue utente
  const isLoop = type === '5' || len > 0;
  return {
    type: isLoop ? 'loop' : hotcue >= 0 ? 'hot' : 'memory',
    index: hotcue >= 0 ? hotcue : null,
    positionMs: start,
    lengthMs: isLoop && len > 0 ? len : null,
    color: null, // Traktor NML non porta un colore RGB per cue
    label: c['@_NAME'] || null
  };
}

// MUSICAL_KEY VALUE 0..23 (Traktor open-key index) → notazione classica.
const TRAKTOR_KEY: Record<number, string> = {
  0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F', 6: 'F#', 7: 'G',
  8: 'G#', 9: 'A', 10: 'A#', 11: 'B',
  12: 'Cm', 13: 'C#m', 14: 'Dm', 15: 'D#m', 16: 'Em', 17: 'Fm',
  18: 'F#m', 19: 'Gm', 20: 'G#m', 21: 'Am', 22: 'A#m', 23: 'Bm'
};

export function readTraktorNml(nmlPath: string): ForeignLibrary {
  const xml = readFileSync(nmlPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false
  });
  const doc = parser.parse(xml);
  const nml = doc?.NML;
  if (!nml?.COLLECTION) throw new Error('File NML non valido: manca NML/COLLECTION.');

  const warnings: string[] = [];
  const tracks: NormTrack[] = [];
  const keyByEntry = new Map<string, string>(); // chiave Traktor → sourceId (uguale)

  for (const e of asArray<Record<string, unknown>>(nml.COLLECTION.ENTRY)) {
    const loc = (e.LOCATION ?? {}) as Record<string, string>;
    const volume = loc['@_VOLUME'];
    const dir = loc['@_DIR'];
    const file = loc['@_FILE'];
    const path = traktorLocationToPath(volume, dir, file);
    // La primary key con cui le playlist referenziano il brano è VOLUME+DIR+FILE.
    const sourceId = `${volume ?? ''}${dir ?? ''}${file ?? ''}`;
    if (!sourceId) continue;
    keyByEntry.set(sourceId, sourceId);

    const info = (e.INFO ?? {}) as Record<string, string>;
    const tempo = (e.TEMPO ?? {}) as Record<string, string>;
    const album = (e.ALBUM ?? {}) as Record<string, string>;
    const mkey = (e.MUSICAL_KEY ?? {}) as Record<string, string>;

    let musicalKey: string | null = info['@_KEY'] || null;
    if (!musicalKey && mkey['@_VALUE'] !== undefined) {
      musicalKey = TRAKTOR_KEY[Number(mkey['@_VALUE'])] ?? null;
    }

    const bpm = tempo['@_BPM'] ? Number(tempo['@_BPM']) || null : null;
    const playtime = info['@_PLAYTIME'] ? Number(info['@_PLAYTIME']) || null : null;
    const yearRaw = info['@_RELEASE_DATE'] ?? (e['@_YEAR'] as string | undefined);
    const year = yearRaw ? Number(String(yearRaw).slice(0, 4)) || null : null;

    const cues = asArray<Record<string, string>>(e.CUE_V2 as never)
      .map(mapCue)
      .filter((c): c is NormCue => c !== null);

    tracks.push({
      sourceId,
      title: (e['@_TITLE'] as string) || null,
      artist: (e['@_ARTIST'] as string) || null,
      album: album['@_TITLE'] || null,
      genre: info['@_GENRE'] || null,
      year,
      bpm,
      musicalKey,
      durationS: playtime,
      path,
      filesize: info['@_FILESIZE'] ? Number(info['@_FILESIZE']) * 1024 || null : null,
      cues
    });
  }

  // Playlist: albero PLAYLISTS → NODE (FOLDER/PLAYLIST).
  const playlists: NormPlaylist[] = [];
  const rootNode = nml.PLAYLISTS?.NODE;
  let counter = 0;
  const walk = (node: Record<string, unknown>, parentId: string | null): void => {
    const type = node['@_TYPE'];
    const name = (node['@_NAME'] as string) ?? 'Senza nome';
    const sid = `pl${counter++}`;
    if (type === 'FOLDER') {
      // Salta la radice tecnica "$ROOT" ma percorri i figli.
      const isRoot = name === '$ROOT';
      if (!isRoot) {
        playlists.push({ sourceId: sid, name, isFolder: true, parentSourceId: parentId, trackSourceIds: [] });
      }
      const subnodes = (node.SUBNODES ?? {}) as Record<string, unknown>;
      for (const child of asArray(subnodes.NODE)) {
        walk(child as Record<string, unknown>, isRoot ? parentId : sid);
      }
    } else if (type === 'PLAYLIST') {
      const pl = (node.PLAYLIST ?? {}) as Record<string, unknown>;
      const entries = asArray(pl.ENTRY);
      const trackSourceIds: string[] = [];
      for (const en of entries) {
        const pk = ((en as Record<string, unknown>).PRIMARYKEY ?? {}) as Record<string, string>;
        const key = pk['@_KEY'];
        if (key && keyByEntry.has(key)) trackSourceIds.push(key);
      }
      playlists.push({ sourceId: sid, name, isFolder: false, parentSourceId: parentId, trackSourceIds });
    }
  };
  for (const n of asArray(rootNode)) walk(n as Record<string, unknown>, null);

  if (tracks.length === 0) warnings.push('Nessun brano trovato nel file NML.');
  return { source: 'traktor', tracks, playlists, warnings };
}
