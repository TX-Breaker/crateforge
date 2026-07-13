import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import {
  ExportSelection,
  getCuesForTrack,
  getPlaylists,
  getPlaylistTrackIds,
  iterateTracks,
  pathToLocation
} from '../common';

/**
 * Export Rekordbox collection XML (per re-import/condivisione).
 * Canale UFFICIALE di scrittura verso Rekordbox: mai INSERT nel master.db.
 * Limiti (§4) mostrati dalla UI prima dell'export: max 8 hot cue, niente
 * colori memory cue / MyTag / smartlist / loop attivi; l'XML non rimuove.
 */
export function writeRekordboxXml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number; playlists: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('DJ_PLAYLISTS', { Version: '1.0.0' });
  root.ele('PRODUCT', { Name: 'CrateForge', Version: '0.1.0', Company: 'TX-Breaker' });

  const collection = root.ele('COLLECTION');
  let count = 0;
  const exportedIds: number[] = [];
  for (const t of iterateTracks(db, sel)) {
    const trackEle = collection.ele('TRACK', {
      TrackID: String(t.id),
      Name: t.title ?? '',
      Artist: t.artist ?? '',
      Album: t.album ?? '',
      Genre: t.genre ?? '',
      Kind: 'MP3 File',
      TotalTime: t.duration_s !== null ? String(Math.round(t.duration_s)) : '0',
      Year: t.year !== null ? String(t.year) : '',
      AverageBpm: t.bpm !== null ? t.bpm.toFixed(2) : '',
      Tonality: t.musical_key ?? '',
      Mix: t.version_label ?? '',
      Location: t.path ? pathToLocation(t.path) : ''
    });
    // Beatgrid: senza un TEMPO Rekordbox importa il brano senza griglia. Non
    // avendo i marker di griglia originali, ancoriamo una griglia a BPM
    // costante dall'inizio (meglio di nessuna griglia; l'utente può correggerla).
    if (t.bpm !== null && t.bpm > 0) {
      trackEle.ele('TEMPO', {
        Inizio: '0.000',
        Bpm: t.bpm.toFixed(2),
        Metro: '4/4',
        Battito: '1'
      });
    }
    // Max 8 hot cue: il limite va applicato QUI, non lasciato all'import.
    const cues = getCuesForTrack(db, t.id);
    let hotCues = 0;
    for (const c of cues) {
      if (c.cue_type === 'hot') {
        if (hotCues >= 8) continue;
        trackEle.ele('POSITION_MARK', {
          Name: c.label ?? '',
          Type: '0',
          Start: (c.position_ms / 1000).toFixed(3),
          Num: String(c.cue_index ?? hotCues),
          ...colorAttrs(c.color)
        });
        hotCues++;
      } else if (c.cue_type === 'memory') {
        trackEle.ele('POSITION_MARK', {
          Name: c.label ?? '',
          Type: '0',
          Start: (c.position_ms / 1000).toFixed(3),
          Num: '-1'
        });
      }
      // loop attivi: non passano dall'XML (§4) → esclusi consapevolmente
    }
    exportedIds.push(t.id);
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }
  collection.att('Entries', String(count));

  const playlistsEle = root.ele('PLAYLISTS');
  const rootNode = playlistsEle.ele('NODE', { Type: '0', Name: 'ROOT' });
  const playlists = getPlaylists(db, sel);
  const exportedSet = new Set(exportedIds);
  const byParent = new Map<number | null, typeof playlists>();
  for (const p of playlists) {
    const list = byParent.get(p.parent_id) ?? [];
    list.push(p);
    byParent.set(p.parent_id, list);
  }
  let plCount = 0;
  const emit = (parentId: number | null, parentEle: typeof rootNode): void => {
    for (const p of byParent.get(parentId) ?? []) {
      if (p.is_folder) {
        const folder = parentEle.ele('NODE', { Type: '0', Name: p.name });
        emit(p.id, folder);
      } else {
        const trackIds = getPlaylistTrackIds(db, p.id).filter((id) => exportedSet.has(id));
        const node = parentEle.ele('NODE', {
          Type: '1',
          Name: p.name,
          KeyType: '0',
          Entries: String(trackIds.length)
        });
        for (const id of trackIds) node.ele('TRACK', { Key: String(id) });
      }
      plCount++;
    }
  };
  emit(null, rootNode);
  rootNode.att('Count', String(byParent.get(null)?.length ?? 0));

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { tracks: count, playlists: plCount };
}

function colorAttrs(hex: string | null): Record<string, string> {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return {};
  return {
    Red: String(parseInt(hex.slice(1, 3), 16)),
    Green: String(parseInt(hex.slice(3, 5), 16)),
    Blue: String(parseInt(hex.slice(5, 7), 16))
  };
}
