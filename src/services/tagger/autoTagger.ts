import type BetterSqlite3 from 'better-sqlite3';
import { logOperation } from '@core/udm';

/**
 * Auto-Tagger (§6 Fase 2.4, modalità Esperto, sperimentale).
 *
 * SOLO query testuali artista/titolo verso MusicBrainz: nessun upload audio,
 * nessun dato personale (§8). Rate-limit 1 req/s (regola MusicBrainz) e retry
 * con backoff. Le modifiche NON vengono applicate da sole: il servizio
 * produce PROPOSTE che l'utente rivede; l'apply scrive solo nell'UDM (mai su
 * file originali) e la strada verso Rekordbox resta l'export XML.
 */

export interface TagProposal {
  trackId: number;
  artist: string;
  title: string;
  field: 'year' | 'genre';
  current: string | null;
  proposed: string;
  source: string; // es. 'MusicBrainz (score 98)'
}

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const MB_ROOT = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'CrateForge/0.1.0 (https://github.com/tx-breaker/crateforge)';

/** Rate limiter seriale: minimo `intervalMs` tra le richieste. */
export class RateLimiter {
  private last = 0;
  constructor(private intervalMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const sleep = this.last + this.intervalMs - now;
    this.last = Math.max(now, this.last + this.intervalMs);
    if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
  }
}

interface MbRecording {
  score?: number;
  title?: string;
  'first-release-date'?: string;
  tags?: { count: number; name: string }[];
}

export async function queryMusicBrainz(
  artist: string,
  title: string,
  fetchFn: FetchFn,
  limiter: RateLimiter,
  retries = 3
): Promise<MbRecording | null> {
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  const url = `${MB_ROOT}/recording?query=${q}&fmt=json&limit=3`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.wait();
    let res;
    try {
      res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch {
      // offline/timeout: riprova con backoff
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { recordings?: MbRecording[] };
    const best = data.recordings?.[0];
    // Sotto 90 il match è troppo incerto per proporre metadati.
    if (!best || (best.score ?? 0) < 90) return null;
    return best;
  }
  return null;
}

export interface ProposeOptions {
  limit?: number; // max brani da interrogare per giro (rate limit!)
  fetchFn?: FetchFn;
  onProgress?: (done: number, total: number) => void;
}

/** Propone year/genre per i brani che ne sono privi ma hanno artista+titolo. */
export async function proposeTags(
  db: BetterSqlite3.Database,
  opts: ProposeOptions = {}
): Promise<{ proposals: TagProposal[]; queried: number; skipped: number }> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchFn);
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = db
    .prepare(
      `SELECT id, artist, title, year, genre FROM tracks
       WHERE artist IS NOT NULL AND title IS NOT NULL
         AND needs_review = 0
         AND (year IS NULL OR genre IS NULL)
       LIMIT ?`
    )
    .all(limit) as { id: number; artist: string; title: string; year: number | null; genre: string | null }[];

  const limiter = new RateLimiter(1100);
  const proposals: TagProposal[] = [];
  let queried = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    const rec = await queryMusicBrainz(t.artist, t.title, fetchFn, limiter);
    queried++;
    if (!rec) {
      skipped++;
    } else {
      const src = `MusicBrainz (score ${rec.score ?? '?'})`;
      const year = rec['first-release-date']?.slice(0, 4);
      if (t.year === null && year && /^\d{4}$/.test(year)) {
        proposals.push({
          trackId: t.id, artist: t.artist, title: t.title,
          field: 'year', current: null, proposed: year, source: src
        });
      }
      const topTag = (rec.tags ?? []).sort((a, b) => b.count - a.count)[0]?.name;
      if (t.genre === null && topTag) {
        proposals.push({
          trackId: t.id, artist: t.artist, title: t.title,
          field: 'genre', current: null, proposed: topTag, source: src
        });
      }
    }
    opts.onProgress?.(i + 1, rows.length);
  }
  return { proposals, queried, skipped };
}

/** Applica le proposte APPROVATE dall'utente: scrive solo nell'UDM. */
export function applyProposals(
  db: BetterSqlite3.Database,
  proposals: TagProposal[]
): { applied: number } {
  const updYear = db.prepare(`UPDATE tracks SET year = ? WHERE id = ?`);
  const updGenre = db.prepare(`UPDATE tracks SET genre = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const p of proposals) {
      if (p.field === 'year') updYear.run(Number(p.proposed), p.trackId);
      else updGenre.run(p.proposed, p.trackId);
    }
  });
  tx();
  logOperation(db, 'tagger.apply', null, 'ok', `${proposals.length} campi aggiornati nell'UDM`);
  return { applied: proposals.length };
}
