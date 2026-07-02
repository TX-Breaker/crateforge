import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import { ExportSelection, getCuesForTrack, iterateTracks } from '../common';

/**
 * Export VirtualDJ database XML (§6 Fase 1.4).
 * Genera un database.xml NUOVO (da importare/unire manualmente in VirtualDJ):
 * non tocca mai il database.xml esistente dell'utente.
 */
export function writeVirtualDjXml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('VirtualDJ_Database', { Version: '2024' });

  let count = 0;
  for (const t of iterateTracks(db, sel)) {
    if (!t.path) continue;
    const song = root.ele('Song', {
      FilePath: t.path,
      FileSize: t.filesize !== null ? String(t.filesize) : ''
    });
    song.ele('Tags', {
      Author: t.artist ?? '',
      Title: t.title ?? '',
      Album: t.album ?? '',
      Genre: t.genre ?? '',
      Year: t.year !== null ? String(t.year) : '',
      Remix: t.version_label ?? ''
    });
    const scan: Record<string, string> = {};
    if (t.bpm !== null && t.bpm > 0) scan.Bpm = (60 / t.bpm).toFixed(6); // VDJ usa secondi-per-beat
    if (t.musical_key) scan.Key = t.musical_key;
    if (Object.keys(scan).length) song.ele('Scan', scan);

    for (const c of getCuesForTrack(db, t.id)) {
      if (c.cue_type === 'hot' && c.cue_index !== null) {
        song.ele('Poi', {
          Name: c.label ?? `Cue ${c.cue_index + 1}`,
          Pos: (c.position_ms / 1000).toFixed(4),
          Num: String(c.cue_index + 1),
          Type: 'cue'
        });
      }
    }
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { tracks: count };
}
