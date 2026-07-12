import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import type { ForeignLibrary, NormCue, NormTrack } from '@core/foreignImport';

/**
 * Reader VirtualDJ database.xml → modello normalizzato.
 * Inverso di adapters/virtualdj/vdjWriter.ts, gestisce i file reali di
 * VirtualDJ. Le playlist di VirtualDJ vivono in file .vdjfolder separati, non
 * in database.xml: qui importiamo brani + cue/loop. Solo lettura.
 */

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * VirtualDJ salva il BPM come secondi-per-beat (es. 0.5 = 120 BPM). Alcuni
 * campi però contengono già i BPM. Euristica: un valore piccolo (<10) è
 * secondi-per-beat, altrimenti è già in BPM.
 */
export function vdjBpm(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw);
  if (!v || Number.isNaN(v) || v <= 0) return null;
  return v < 10 ? 60 / v : v;
}

function mapPoi(p: Record<string, string>): NormCue | null {
  const pos = Number(p['@_Pos']);
  if (Number.isNaN(pos)) return null;
  const type = (p['@_Type'] || 'cue').toLowerCase();
  if (type !== 'cue' && type !== 'loop' && type !== 'hotcue') return null; // salta beatgrid/remix/automix
  const size = p['@_Size'] !== undefined ? Number(p['@_Size']) : 0;
  const num = p['@_Num'] !== undefined ? Number(p['@_Num']) : NaN;
  const isLoop = type === 'loop' || size > 0;
  return {
    type: isLoop ? 'loop' : 'hot',
    index: !isLoop && !Number.isNaN(num) ? Math.max(0, num - 1) : null,
    positionMs: pos * 1000,
    lengthMs: isLoop && size > 0 ? size * 1000 : null,
    color: null,
    label: p['@_Name'] || null
  };
}

export function readVirtualDjXml(dbPath: string): ForeignLibrary {
  const xml = readFileSync(dbPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false
  });
  const doc = parser.parse(xml);
  const root = doc?.VirtualDJ_Database;
  if (!root) throw new Error('File non valido: manca VirtualDJ_Database.');

  const warnings: string[] = [];
  const tracks: NormTrack[] = [];
  for (const s of asArray<Record<string, unknown>>(root.Song)) {
    const path = (s['@_FilePath'] as string) || null;
    if (!path) continue;
    const tags = (s.Tags ?? {}) as Record<string, string>;
    const infos = (s.Infos ?? {}) as Record<string, string>;
    const scan = (s.Scan ?? {}) as Record<string, string>;

    const bpm = vdjBpm(tags['@_Bpm']) ?? vdjBpm(scan['@_Bpm']);
    const key = tags['@_Key'] || scan['@_Key'] || null;
    const year = tags['@_Year'] ? Number(tags['@_Year']) || null : null;
    const durationS = infos['@_SongLength'] ? Number(infos['@_SongLength']) || null : null;
    const filesize = (s['@_FileSize'] || infos['@_FileSize'])
      ? Number(s['@_FileSize'] ?? infos['@_FileSize']) || null
      : null;

    const cues = asArray<Record<string, string>>(s.Poi as never)
      .map(mapPoi)
      .filter((c): c is NormCue => c !== null);

    tracks.push({
      sourceId: path, // FilePath è l'identificatore stabile in VirtualDJ
      title: tags['@_Title'] || null,
      artist: tags['@_Author'] || null,
      album: tags['@_Album'] || null,
      genre: tags['@_Genre'] || null,
      year,
      bpm,
      musicalKey: key,
      durationS,
      path,
      filesize,
      cues
    });
  }

  if (tracks.length === 0) warnings.push('Nessun brano trovato nel database VirtualDJ.');
  warnings.push('Le playlist di VirtualDJ non sono nel database.xml (file .vdjfolder separati): importati solo brani e cue.');
  return { source: 'virtualdj', tracks, playlists: [], warnings };
}
