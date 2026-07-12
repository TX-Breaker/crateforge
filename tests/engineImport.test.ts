import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-engine-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Crea un finto Engine Library m.db con lo schema minimo comune. */
function makeEngineDb(): string {
  const p = join(dir, 'm.db');
  const db = new Database(p);
  db.exec(`
    CREATE TABLE Track (
      id INTEGER PRIMARY KEY, title TEXT, artist TEXT, album TEXT, genre TEXT,
      year INTEGER, bpmAnalyzed REAL, keyAnalyzed INTEGER, length INTEGER,
      path TEXT, fileBytes INTEGER
    );
    CREATE TABLE Playlist (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE PlaylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER);
  `);
  const ins = db.prepare(
    `INSERT INTO Track (id,title,artist,album,genre,year,bpmAnalyzed,keyAnalyzed,length,path,fileBytes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  ins.run(1, 'One More Time', 'Daft Punk', 'Discovery', 'House', 2000, 123.0, 21, 320, 'C:\\Music\\omt.mp3', 8000000);
  ins.run(2, 'Aerodynamic', 'Daft Punk', 'Discovery', 'House', 2001, 123.0, 8, 210, 'C:\\Music\\aero.mp3', 6000000);
  db.prepare(`INSERT INTO Playlist (id,title) VALUES (1,'Discovery')`).run();
  db.prepare(`INSERT INTO PlaylistEntity (id,listId,trackId) VALUES (1,1,1),(2,1,2)`).run();
  db.close();
  return p;
}

describe('readEngineLibrary', () => {
  it('legge brani, bpm, key (0-23), playlist da SQLite in chiaro', () => {
    const p = makeEngineDb();
    const lib = readEngineLibrary(p);
    expect(lib.source).toBe('engine');
    expect(lib.tracks).toHaveLength(2);
    const omt = lib.tracks.find((t) => t.sourceId === '1')!;
    expect(omt.title).toBe('One More Time');
    expect(omt.bpm).toBe(123);
    expect(omt.musicalKey).toBe('Am'); // keyAnalyzed 21 → Am
    expect(omt.path).toBe('C:\\Music\\omt.mp3');
    expect(lib.tracks.find((t) => t.sourceId === '2')!.musicalKey).toBe('G#'); // 8 → G#
    expect(lib.playlists).toHaveLength(1);
    expect(lib.playlists[0].trackSourceIds).toEqual(['1', '2']);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
  });

  it('import nell UDM: 2 brani + playlist collegata', () => {
    const p = makeEngineDb();
    const db = new Database(':memory:');
    migrate(db);
    const r = importForeignLibrary(db, readEngineLibrary(p));
    expect(r.tracks).toBe(2);
    expect(r.playlists).toBe(1);
    const linked = db.prepare(`SELECT COUNT(*) c FROM playlist_tracks`).get() as { c: number };
    expect(linked.c).toBe(2);
    const cam = db.prepare(`SELECT camelot FROM tracks WHERE source_id='1'`).get() as { camelot: string };
    expect(cam.camelot).toBe('8A'); // Am → 8A
  });

  it('rifiuta un db senza tabella Track', () => {
    const p = join(dir, 'bad.db');
    const db = new Database(p);
    db.exec(`CREATE TABLE Nope (id INTEGER)`);
    db.close();
    expect(() => readEngineLibrary(p)).toThrow(/Track/);
  });
});
