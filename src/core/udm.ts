import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from './schema';

/**
 * Apre (creandolo se manca) il database UDM in chiaro.
 * Node è l'owner di schema e migrazioni; WAL + busy_timeout per convivere
 * con il sidecar Python che scrive nelle tabelle di ingestion.
 */
export function openUdm(udmPath: string): BetterSqlite3.Database {
  const db = new Database(udmPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export interface TrackRow {
  id: number;
  source: 'masterdb' | 'xml';
  source_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musical_key: string | null;
  camelot: string | null;
  duration_s: number | null;
  path: string | null;
  filesize: number | null;
  file_mtime: number | null;
  version_label: string | null;
  has_tag_issues: number;
  needs_review: number;
  review_reason: string | null;
  acoustic_id: string | null;
}

export interface PageQuery {
  offset: number;
  limit: number;
  search?: string;
  needsReview?: boolean;
}

/** Lettura paginata: la UI non riceve mai l'intera libreria in un colpo solo. */
export function getTracksPage(db: BetterSqlite3.Database, q: PageQuery): { rows: TrackRow[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (q.search) {
    where.push(`(title LIKE :s OR artist LIKE :s OR path LIKE :s)`);
    params.s = `%${q.search}%`;
  }
  if (q.needsReview !== undefined) {
    where.push(`needs_review = :nr`);
    params.nr = q.needsReview ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks ${whereSql}`).get(params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT * FROM tracks ${whereSql} ORDER BY artist, title LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit: q.limit, offset: q.offset }) as TrackRow[];
  return { rows, total };
}

/** Brani di una playlist, paginati e in ordine di posizione. */
export function getPlaylistTracksPage(
  db: BetterSqlite3.Database,
  playlistId: number,
  offset: number,
  limit: number
): { rows: TrackRow[]; total: number } {
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = ?`)
      .get(playlistId) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position LIMIT ? OFFSET ?`
    )
    .all(playlistId, limit, offset) as TrackRow[];
  return { rows, total };
}

export function logOperation(
  db: BetterSqlite3.Database,
  operation: string,
  target: string | null,
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped',
  detail?: string
): void {
  db.prepare(
    `INSERT INTO oplog (operation, target, outcome, detail) VALUES (?, ?, ?, ?)`
  ).run(operation, target, outcome, detail ?? null);
}

export function getSetting(db: BetterSqlite3.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: BetterSqlite3.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
