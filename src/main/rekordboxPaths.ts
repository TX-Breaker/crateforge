import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Percorsi di DEFAULT dell'installazione Rekordbox dell'utente corrente.
 *
 * Calcolati dinamicamente dalla home dell'utente (mai hard-coded): valgono sia
 * su questo Mac sia su quello di qualunque altro utente a cui l'app è
 * distribuita. Servono a pre-puntare il file picker (e, se il master.db è già
 * lì, a leggerlo con un clic).
 *
 *   macOS   : ~/Library/Pioneer/rekordbox/master.db
 *   Windows : %APPDATA%\Pioneer\rekordbox\master.db
 */
export interface RekordboxPaths {
  dir: string;
  masterDb: string;
  masterDbExists: boolean;
  optionsJson: string;
  optionsJsonExists: boolean;
}

export function rekordboxDir(): string {
  if (process.platform === 'darwin') {
    return join(app.getPath('home'), 'Library', 'Pioneer', 'rekordbox');
  }
  if (process.platform === 'win32') {
    // appData su Windows = Roaming, dove Rekordbox tiene Pioneer\rekordbox.
    return join(app.getPath('appData'), 'Pioneer', 'rekordbox');
  }
  // Linux: Rekordbox non è supportato, ma restiamo coerenti col resto.
  return join(app.getPath('home'), 'Pioneer', 'rekordbox');
}

export function rekordboxDefaultPaths(): RekordboxPaths {
  const dir = rekordboxDir();
  const masterDb = join(dir, 'master.db');
  const optionsJson = join(dir, 'options.json');
  return {
    dir,
    masterDb,
    masterDbExists: existsSync(masterDb),
    optionsJson,
    optionsJsonExists: existsSync(optionsJson)
  };
}
