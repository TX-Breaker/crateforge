import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { ingestCollectionXml } from '@core/xmlCollection';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';

const FIXTURE = join(__dirname, 'fixtures', 'collection.xml');

let tmp: string;
let db: InstanceType<typeof Database>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'crateforge-test-'));
  db = new Database(':memory:');
  migrate(db);
  ingestCollectionXml(db, FIXTURE);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function parse(path: string) {
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(
    readFileSync(path, 'utf-8')
  );
}

describe('writeRekordboxXml', () => {
  it('produce XML valido con struttura attesa', () => {
    const out = join(tmp, 'rb.xml');
    const r = writeRekordboxXml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.DJ_PLAYLISTS['@_Version']).toBe('1.0.0');
    expect(doc.DJ_PLAYLISTS.COLLECTION['@_Entries']).toBe('4');
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK;
    expect(tracks).toHaveLength(4);
  });

  it('applica il limite di 8 hot cue (§4)', () => {
    const out = join(tmp, 'rb.xml');
    writeRekordboxXml(db, out);
    const doc = parse(out);
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK as Record<string, unknown>[];
    const levels = tracks.find((t) => (t['@_Name'] as string).startsWith('Levels'))!;
    const marks = levels.POSITION_MARK as Record<string, string>[];
    const hot = marks.filter((m) => Number(m['@_Num']) >= 0);
    const memory = marks.filter((m) => m['@_Num'] === '-1');
    expect(hot).toHaveLength(8); // dalle 10 in ingresso
    expect(memory).toHaveLength(1);
    // loop attivi esclusi consapevolmente: nessun mark con End
    expect(marks.every((m) => m['@_End'] === undefined)).toBe(true);
  });

  it('scrive Location come file URL', () => {
    const out = join(tmp, 'rb.xml');
    writeRekordboxXml(db, out);
    const doc = parse(out);
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK as Record<string, string>[];
    expect(tracks[0]['@_Location']).toMatch(/^file:\/\/localhost\//);
  });
});

describe('writeTraktorNml', () => {
  it('produce NML con ENTRY per traccia', () => {
    const out = join(tmp, 'traktor.nml');
    const r = writeTraktorNml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.NML['@_VERSION']).toBeDefined();
    expect(doc.NML.COLLECTION.ENTRY).toHaveLength(4);
  });
});

describe('writeVirtualDjXml', () => {
  it('produce database XML con Song per traccia', () => {
    const out = join(tmp, 'vdj.xml');
    const r = writeVirtualDjXml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.VirtualDJ_Database.Song).toHaveLength(4);
  });
});
