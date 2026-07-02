import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import { basename, dirname } from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import {
  ExportSelection,
  getCuesForTrack,
  getPlaylists,
  getPlaylistTrackIds,
  iterateTracks
} from '../common';

/**
 * Export Traktor NML (§6 Fase 1.4): hot cue, beatgrid (BPM), playlist.
 * Solo scrittura di un file nuovo: nessun tocco al collection.nml esistente.
 */
export function writeTraktorNml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number; playlists: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8', standalone: false });
  const nml = doc.ele('NML', { VERSION: '19' });
  nml.ele('HEAD', { COMPANY: 'CrateForge', PROGRAM: 'CrateForge' });

  const collection = nml.ele('COLLECTION');
  let count = 0;
  const keyByTrackId = new Map<number, string>();
  for (const t of iterateTracks(db, sel)) {
    if (!t.path) continue;
    const dir = traktorDir(t.path);
    const file = basename(t.path);
    const volume = traktorVolume(t.path);
    keyByTrackId.set(t.id, `${volume}${dir}${file}`);

    const entry = collection.ele('ENTRY', {
      TITLE: t.title ?? '',
      ARTIST: t.artist ?? ''
    });
    entry.ele('LOCATION', { DIR: dir, FILE: file, VOLUME: volume });
    entry.ele('ALBUM', { TITLE: t.album ?? '' });
    entry.ele('INFO', {
      GENRE: t.genre ?? '',
      PLAYTIME: t.duration_s !== null ? String(Math.round(t.duration_s)) : '',
      RELEASE_DATE: t.year !== null ? `${t.year}/1/1` : ''
    });
    if (t.bpm !== null) {
      entry.ele('TEMPO', { BPM: t.bpm.toFixed(6), BPM_QUALITY: '100.000000' });
    }
    if (t.musical_key) {
      entry.ele('MUSICAL_KEY', { VALUE: t.musical_key });
    }
    for (const c of getCuesForTrack(db, t.id)) {
      if (c.cue_type === 'hot' && c.cue_index !== null && c.cue_index < 8) {
        entry.ele('CUE_V2', {
          NAME: c.label ?? `Cue ${c.cue_index + 1}`,
          TYPE: '0',
          START: c.position_ms.toFixed(3),
          LEN: '0.000000',
          HOTCUE: String(c.cue_index)
        });
      } else if (c.cue_type === 'loop' && c.length_ms !== null) {
        entry.ele('CUE_V2', {
          NAME: c.label ?? 'Loop',
          TYPE: '5',
          START: c.position_ms.toFixed(3),
          LEN: c.length_ms.toFixed(3),
          HOTCUE: '-1'
        });
      }
    }
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }
  collection.att('ENTRIES', String(count));

  // Playlist
  const playlistsRoot = nml
    .ele('PLAYLISTS')
    .ele('NODE', { TYPE: 'FOLDER', NAME: '$ROOT' })
    .ele('SUBNODES');
  const playlists = getPlaylists(db, sel).filter((p) => !p.is_folder);
  let plCount = 0;
  for (const p of playlists) {
    const trackIds = getPlaylistTrackIds(db, p.id);
    const keys = trackIds.map((id) => keyByTrackId.get(id)).filter((k): k is string => !!k);
    const node = playlistsRoot.ele('NODE', { TYPE: 'PLAYLIST', NAME: p.name });
    const pl = node.ele('PLAYLIST', {
      ENTRIES: String(keys.length),
      TYPE: 'LIST',
      UUID: `crateforge-${p.id}`
    });
    for (const k of keys) {
      pl.ele('ENTRY').ele('PRIMARYKEY', { TYPE: 'TRACK', KEY: k });
    }
    plCount++;
  }
  playlistsRoot.att('COUNT', String(plCount));

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { tracks: count, playlists: plCount };
}

/** C:\Music\House\a.mp3 → /:Music/:House/: ; /Users/x/a.mp3 → /:Users/:x/: */
export function traktorDir(p: string): string {
  const posix = p.replace(/\\/g, '/');
  const dir = dirname(posix.replace(/^[A-Za-z]:/, ''));
  const parts = dir.split('/').filter(Boolean);
  return `/:${parts.join('/:')}${parts.length ? '/:' : ''}`;
}

export function traktorVolume(p: string): string {
  const m = p.match(/^([A-Za-z]:)/);
  return m ? m[1] : '';
}
