import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { findOrphans, quarantineOrphans } from '@services/orphans/orphanFinder';

let tmp: string;
let db: InstanceType<typeof Database>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'crateforge-orphans-'));
  db = new Database(':memory:');
  migrate(db);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeMusicDir(): string {
  const music = join(tmp, 'music');
  mkdirSync(join(music, 'sub'), { recursive: true });
  writeFileSync(join(music, 'known.mp3'), 'a'.repeat(100));
  writeFileSync(join(music, 'orphan1.mp3'), 'b'.repeat(200));
  writeFileSync(join(music, 'sub', 'orphan2.flac'), 'c'.repeat(300));
  writeFileSync(join(music, 'not-audio.txt'), 'x'); // ignorato
  return music;
}

describe('findOrphans (diff disco vs libreria)', () => {
  it('trova solo i file assenti dal DB, case-insensitive', () => {
    const music = makeMusicDir();
    // path noto con case diverso: NON deve risultare orfano
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES ('xml', '1', 'K', ?)`
    ).run(join(music, 'KNOWN.MP3'));

    return findOrphans(db, music).then((r) => {
      expect(r.scannedFiles).toBe(3); // txt escluso
      const names = r.orphans.map((o) => o.path);
      expect(names).toHaveLength(2);
      expect(names.some((p) => p.endsWith('orphan1.mp3'))).toBe(true);
      expect(names.some((p) => p.endsWith('orphan2.flac'))).toBe(true);
      expect(r.reclaimableBytes).toBe(500);
    });
  });
});

describe('quarantineOrphans', () => {
  it('dry-run non tocca nulla (§3.6)', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await quarantineOrphans(db, [orphan], join(tmp, 'quarantine'), true);
    expect(r.moved).toBe(1);
    expect(existsSync(orphan)).toBe(true); // ancora al suo posto
    const log = db.prepare(`SELECT outcome FROM oplog ORDER BY id DESC LIMIT 1`).get() as {
      outcome: string;
    };
    expect(log.outcome).toBe('dry-run');
  });

  it('esecuzione sposta (mai elimina) e logga', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await quarantineOrphans(db, [orphan], join(tmp, 'quarantine'), false);
    expect(r.moved).toBe(1);
    expect(r.failed).toHaveLength(0);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(r.quarantineDir, 'orphan1.mp3'))).toBe(true);
  });
});
