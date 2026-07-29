/**
 * Profilo di piattaforma (§ OS target).
 *
 * CrateForge gira sia su Windows sia su macOS, ma quasi tutto ciò che l'utente
 * legge sullo schermo cambia tra i due mondi: le SCORCIATOIE da tastiera
 * (Ctrl vs ⌘), i PERCORSI dove i software DJ tengono le loro librerie, i
 * COMANDI da terminale, perfino il nome del file manager ("Esplora risorse" vs
 * "Finder").
 *
 * Il profilo è deliberatamente separato dalla piattaforma REALE su cui gira il
 * processo: un utente può stare su Windows e voler leggere le istruzioni per il
 * Mac su cui suona (o viceversa). L'app rileva l'OS e lo PRE-SELEZIONA, ma
 * l'ultima parola è dell'utente (§1 onestà: mostrare percorsi di un altro OS
 * senza dirlo sarebbe fuorviante).
 *
 * Modulo puro: nessun import da Electron/Node, così è testabile e utilizzabile
 * sia nel main sia nel renderer.
 */

export type TargetOs = 'win' | 'mac';

export function osFromNodePlatform(p: string): TargetOs {
  return p === 'darwin' ? 'mac' : 'win';
}

export function osLabel(os: TargetOs): string {
  return os === 'mac' ? 'macOS' : 'Windows';
}

/* ---------------------------------------------------------------- tastiera */

/** Azioni per cui mostriamo una scorciatoia nella UI. */
export type ShortcutAction =
  | 'copy'
  | 'paste'
  | 'cut'
  | 'selectAll'
  | 'find'
  | 'quit'
  | 'close'
  | 'settings'
  | 'reload'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'devtools';

const SHORTCUTS: Record<TargetOs, Record<ShortcutAction, string>> = {
  win: {
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    cut: 'Ctrl+X',
    selectAll: 'Ctrl+A',
    find: 'Ctrl+F',
    quit: 'Alt+F4',
    close: 'Ctrl+W',
    settings: 'Ctrl+,',
    reload: 'Ctrl+R',
    zoomIn: 'Ctrl++',
    zoomOut: 'Ctrl+-',
    zoomReset: 'Ctrl+0',
    devtools: 'Ctrl+Shift+I'
  },
  mac: {
    copy: '⌘C',
    paste: '⌘V',
    cut: '⌘X',
    selectAll: '⌘A',
    find: '⌘F',
    quit: '⌘Q',
    close: '⌘W',
    settings: '⌘,',
    reload: '⌘R',
    zoomIn: '⌘+',
    zoomOut: '⌘-',
    zoomReset: '⌘0',
    devtools: '⌥⌘I'
  }
};

export function shortcut(os: TargetOs, action: ShortcutAction): string {
  return SHORTCUTS[os][action];
}

/** Tasto "modificatore principale" da usare nei testi ("tieni premuto …"). */
export function primaryModifier(os: TargetOs): string {
  return os === 'mac' ? '⌘ (Comando)' : 'Ctrl';
}

/** Nome del file manager, per istruzioni tipo "apri la cartella in …". */
export function fileManagerName(os: TargetOs): string {
  return os === 'mac' ? 'Finder' : 'Esplora risorse';
}

/** Nome dell'app terminale, per i comandi copia-incolla. */
export function terminalName(os: TargetOs): string {
  return os === 'mac' ? 'Terminale' : 'PowerShell';
}

/* ---------------------------------------------------------------- percorsi */

export type DjSoftware = 'rekordbox' | 'serato' | 'traktor' | 'virtualdj' | 'engine';

export interface LibraryLocation {
  software: DjSoftware;
  /** Nome mostrato all'utente. */
  label: string;
  /**
   * Percorso tipico, con i placeholder dell'OS scelto ($HOME / %USERPROFILE%).
   * NON è un percorso risolto: serve a far capire all'utente DOVE cercare nel
   * file picker. La risoluzione reale (dove implementata) passa da
   * rekordboxPaths.ts nel main, che usa app.getPath.
   */
  path: string;
  /** Cosa selezionare nel file picker: file singolo o cartella. */
  pick: 'file' | 'dir';
  note?: string;
}

const LOCATIONS: Record<TargetOs, LibraryLocation[]> = {
  win: [
    {
      software: 'rekordbox',
      label: 'Rekordbox — database',
      path: '%APPDATA%\\Pioneer\\rekordbox\\master.db',
      pick: 'file'
    },
    {
      software: 'rekordbox',
      label: 'Rekordbox — options.json (chiave)',
      path: '%APPDATA%\\Pioneer\\rekordboxAgent\\storage\\options.json',
      pick: 'file',
      note: 'Usato solo se la chiave di lettura non è già in cache.'
    },
    {
      software: 'serato',
      label: 'Serato — cartella _Serato_',
      path: '%USERPROFILE%\\Music\\_Serato_',
      pick: 'dir',
      note: 'Su disco esterno la cartella _Serato_ sta nella radice del disco (es. D:\\_Serato_).'
    },
    {
      software: 'traktor',
      label: 'Traktor — collection.nml',
      path: '%USERPROFILE%\\Documents\\Native Instruments\\Traktor <versione>\\collection.nml',
      pick: 'file'
    },
    {
      software: 'virtualdj',
      // VERIFICATO installando VirtualDJ 2026 (b9482) su questa macchina:
      // la cartella dati è in LOCAL AppData, non in Roaming.
      label: 'VirtualDJ — database.xml',
      path: '%LOCALAPPDATA%\\VirtualDJ\\database.xml',
      pick: 'file',
      note: 'VirtualDJ tiene un database.xml anche sulla radice di ogni disco usato.'
    },
    {
      software: 'engine',
      label: 'Engine DJ — m.db',
      path: '%USERPROFILE%\\Music\\Engine Library\\Database2\\m.db',
      pick: 'file'
    }
  ],
  mac: [
    {
      software: 'rekordbox',
      label: 'Rekordbox — database',
      path: '~/Library/Pioneer/rekordbox/master.db',
      pick: 'file'
    },
    {
      software: 'rekordbox',
      label: 'Rekordbox — options.json (chiave)',
      path: '~/Library/Application Support/Pioneer/rekordboxAgent/storage/options.json',
      pick: 'file',
      note: 'Usato solo se la chiave di lettura non è già in cache.'
    },
    {
      software: 'serato',
      label: 'Serato — cartella _Serato_',
      path: '~/Music/_Serato_',
      pick: 'dir',
      note: 'Su disco esterno: /Volumes/<disco>/_Serato_.'
    },
    {
      software: 'traktor',
      label: 'Traktor — collection.nml',
      path: '~/Documents/Native Instruments/Traktor <versione>/collection.nml',
      pick: 'file'
    },
    {
      software: 'virtualdj',
      label: 'VirtualDJ — database.xml',
      path: '~/Library/Application Support/VirtualDJ/database.xml',
      pick: 'file',
      note: 'VirtualDJ tiene un database.xml anche sulla radice di ogni disco usato.'
    },
    {
      software: 'engine',
      label: 'Engine DJ — m.db',
      path: '~/Music/Engine Library/Database2/m.db',
      pick: 'file'
    }
  ]
};

export function libraryLocations(os: TargetOs, software?: DjSoftware): LibraryLocation[] {
  const all = LOCATIONS[os];
  return software ? all.filter((l) => l.software === software) : all;
}

/* --------------------------------------------------------------- terminale */

/**
 * Comando per aprire una cartella nel file manager dell'OS scelto.
 * Il path va passato già quotato dal chiamante se contiene spazi.
 */
export function revealCommand(os: TargetOs, path: string): string {
  return os === 'mac' ? `open "${path}"` : `explorer "${path}"`;
}

/** Comando che toglie la quarantena Gatekeeper (solo macOS: su Windows n/a). */
export function unquarantineCommand(os: TargetOs, appPath = '/Applications/CrateForge.app'): string | null {
  return os === 'mac' ? `xattr -dr com.apple.quarantine ${appPath}` : null;
}

/**
 * Come l'utente sblocca l'app scaricata e non firmata, in una riga.
 * Su Windows è SmartScreen, su macOS Gatekeeper (che da Sequoia non accetta
 * più il vecchio "tasto destro → Apri").
 */
export function unblockHint(os: TargetOs): string {
  return os === 'mac'
    ? 'macOS 15+: apri l\'app, poi Impostazioni di Sistema → Privacy e Sicurezza → "Apri comunque". Su macOS 13/14: tasto destro sull\'app → Apri.'
    : 'Windows SmartScreen: clicca "Ulteriori informazioni" → "Esegui comunque".';
}
