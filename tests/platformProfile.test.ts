import { describe, expect, it } from 'vitest';
import {
  libraryLocations,
  osFromNodePlatform,
  osLabel,
  primaryModifier,
  revealCommand,
  shortcut,
  unblockHint,
  unquarantineCommand,
  type TargetOs
} from '@core/platformProfile';

/**
 * Profilo OS (§): l'app deve mostrare scorciatoie, percorsi e comandi del
 * sistema SCELTO dall'utente, non di quello su cui gira. Questi test bloccano
 * le regressioni più insidiose: un percorso Windows mostrato a un utente Mac
 * (o viceversa) manda la persona a cercare un file che non esiste.
 */

describe('osFromNodePlatform', () => {
  it('mappa darwin su mac e tutto il resto su win', () => {
    expect(osFromNodePlatform('darwin')).toBe('mac');
    expect(osFromNodePlatform('win32')).toBe('win');
    // Linux: Rekordbox non esiste, ma il profilo deve restare deterministico.
    expect(osFromNodePlatform('linux')).toBe('win');
  });
});

describe('scorciatoie', () => {
  it('usa Ctrl su Windows e ⌘ su macOS', () => {
    expect(shortcut('win', 'copy')).toBe('Ctrl+C');
    expect(shortcut('mac', 'copy')).toBe('⌘C');
    expect(primaryModifier('win')).toContain('Ctrl');
    expect(primaryModifier('mac')).toContain('⌘');
  });

  it('non mescola mai i modificatori tra i due profili', () => {
    const actions = ['copy', 'paste', 'cut', 'selectAll', 'find', 'close'] as const;
    for (const a of actions) {
      expect(shortcut('win', a)).toMatch(/^(Ctrl|Alt)/);
      expect(shortcut('mac', a)).not.toContain('Ctrl');
    }
  });

  it('quit differisce: Alt+F4 su Windows, ⌘Q su macOS', () => {
    expect(shortcut('win', 'quit')).toBe('Alt+F4');
    expect(shortcut('mac', 'quit')).toBe('⌘Q');
  });
});

describe('percorsi librerie DJ', () => {
  it('copre gli stessi software su entrambi i sistemi', () => {
    const sw = (os: TargetOs) => new Set(libraryLocations(os).map((l) => l.software));
    expect(sw('win')).toEqual(sw('mac'));
    expect(sw('win').size).toBeGreaterThanOrEqual(5); // rekordbox/serato/traktor/vdj/engine
  });

  it('usa variabili d\'ambiente Windows e tilde su macOS, senza contaminarsi', () => {
    for (const l of libraryLocations('win')) {
      expect(l.path).toMatch(/^%(APPDATA|LOCALAPPDATA|USERPROFILE)%\\/);
      expect(l.path).not.toContain('~/');
    }
    for (const l of libraryLocations('mac')) {
      expect(l.path.startsWith('~/')).toBe(true);
      expect(l.path).not.toContain('%APPDATA%');
      expect(l.path).not.toContain('\\');
    }
  });

  it('punta al master.db di Rekordbox nel posto giusto per ciascun sistema', () => {
    const win = libraryLocations('win', 'rekordbox')[0];
    const mac = libraryLocations('mac', 'rekordbox')[0];
    expect(win.path).toBe('%APPDATA%\\Pioneer\\rekordbox\\master.db');
    expect(mac.path).toBe('~/Library/Pioneer/rekordbox/master.db');
    expect(win.pick).toBe('file');
    expect(mac.pick).toBe('file');
  });

  it('VirtualDJ su Windows sta in LOCALAPPDATA, non in Roaming', () => {
    // Verificato installando VirtualDJ 2026 su Windows: la cartella dati è
    // %LOCALAPPDATA%\VirtualDJ. Indicare Roaming mandava l'utente a cercare
    // un file che non esiste.
    expect(libraryLocations('win', 'virtualdj')[0].path).toContain('%LOCALAPPDATA%');
    expect(libraryLocations('mac', 'virtualdj')[0].path).toContain('Application Support');
  });

  it('la cartella _Serato_ è indicata come cartella, non come file', () => {
    for (const os of ['win', 'mac'] as TargetOs[]) {
      expect(libraryLocations(os, 'serato')[0].pick).toBe('dir');
    }
  });
});

describe('comandi di sistema', () => {
  it('apre le cartelle col comando nativo del sistema scelto', () => {
    expect(revealCommand('win', 'C:\\Music')).toBe('explorer "C:\\Music"');
    expect(revealCommand('mac', '/Users/x/Music')).toBe('open "/Users/x/Music"');
  });

  it('espone xattr solo su macOS (su Windows non esiste)', () => {
    expect(unquarantineCommand('mac')).toContain('xattr -dr com.apple.quarantine');
    expect(unquarantineCommand('win')).toBeNull();
  });

  it('spiega lo sblocco col nome giusto della protezione', () => {
    expect(unblockHint('win')).toContain('SmartScreen');
    expect(unblockHint('mac')).toContain('Privacy e Sicurezza');
  });

  it('etichetta i sistemi in modo leggibile', () => {
    expect(osLabel('win')).toBe('Windows');
    expect(osLabel('mac')).toBe('macOS');
  });
});
