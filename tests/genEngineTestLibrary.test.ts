import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';

/**
 * Utility (non un test di regressione): genera la libreria Engine di prova da
 * far aprire all'utente, con i path calcolati per la posizione in cui verrà
 * effettivamente usata (CRATEFORGE_ENGINE_PATHBASE).
 *
 * Si salta sempre, tranne quando si imposta CRATEFORGE_ENGINE_OUT.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const OUT = process.env.CRATEFORGE_ENGINE_OUT;
const PATH_BASE = process.env.CRATEFORGE_ENGINE_PATHBASE;

describe.skipIf(!OUT || !existsSync(ENGINE_DB))('genera libreria Engine di prova', () => {
  it('scrive la libreria richiesta', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-genengine-'));
    try {
      const src = join(tmp, 'm.db');
      copyFileSync(ENGINE_DB, src);
      const udm = new Database(':memory:');
      migrate(udm);
      importForeignLibrary(udm, readEngineLibrary(src));

      const res = writeEngineLibrary(udm, OUT!, ENGINE_DB, {}, undefined, PATH_BASE);
      udm.close();
      console.log(
        `[gen] ${res.tracks} tracce, ${res.cues} cue, ${res.loops} loop → ${res.dbPath}` +
          (PATH_BASE ? ` (path relativi a ${PATH_BASE})` : '')
      );

      // Prova di lettura: i path devono puntare a file che esistono davvero.
      const back = readEngineLibrary(res.dbPath);
      const sample = back.tracks.slice(0, 3).map((t) => t.path);
      console.log(`[gen] esempi di percorso risolto:`);
      for (const p of sample) console.log(`[gen]   ${p} → ${p && existsSync(p) ? 'ESISTE' : 'MANCA'}`);
      expect(existsSync(res.dbPath)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
