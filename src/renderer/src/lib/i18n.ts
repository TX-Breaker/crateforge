/**
 * Localizzazione minima it/en. Italiano = locale primario (§1).
 */
export type Locale = 'it' | 'en';

const dict = {
  it: {
    'nav.dashboard': 'Panoramica',
    'nav.backup': 'Backup',
    'nav.orphans': 'File orfani',
    'nav.report': 'Report Excel',
    'nav.converter': 'Converti libreria',
    'nav.relocator': 'Ritrova file spostati',
    'nav.dedup': 'Duplicati (impronta)',
    'nav.autocue': 'Auto-Cue',
    'nav.tagger': 'Auto-Tagger',
    'nav.stems': 'Stems',
    'nav.review': 'Da revisionare',
    'nav.log': 'Registro operazioni',
    'nav.settings': 'Impostazioni',
    'nav.about': 'Informazioni',
    'mode.simple': 'Semplice',
    'mode.expert': 'Esperto',
    'common.cancel': 'Annulla',
    'common.continue': 'Continua',
    'common.close': 'Chiudi',
    'common.browse': 'Sfoglia…',
    'common.dryRunNote': 'Prima ti mostro un\'anteprima: nessun file viene toccato finché non confermi.',
    'danger.typeToConfirm': 'Per confermare, scrivi',
    'danger.understood': 'Ho capito i rischi',
    'safety.readonly': 'I tuoi file originali restano intatti: CrateForge lavora solo su copie.'
  },
  en: {
    'nav.dashboard': 'Overview',
    'nav.backup': 'Backup',
    'nav.orphans': 'Orphan files',
    'nav.report': 'Excel report',
    'nav.converter': 'Convert library',
    'nav.relocator': 'Relocate moved files',
    'nav.dedup': 'Duplicates (fingerprint)',
    'nav.autocue': 'Auto-Cue',
    'nav.tagger': 'Auto-Tagger',
    'nav.stems': 'Stems',
    'nav.review': 'Needs review',
    'nav.log': 'Operation log',
    'nav.settings': 'Settings',
    'nav.about': 'About',
    'mode.simple': 'Simple',
    'mode.expert': 'Expert',
    'common.cancel': 'Cancel',
    'common.continue': 'Continue',
    'common.close': 'Close',
    'common.browse': 'Browse…',
    'common.dryRunNote': 'You get a preview first: nothing is touched until you confirm.',
    'danger.typeToConfirm': 'To confirm, type',
    'danger.understood': 'I understand the risks',
    'safety.readonly': 'Your original files stay untouched: CrateForge only works on copies.'
  }
} as const;

export type MsgKey = keyof (typeof dict)['it'];

export function t(locale: Locale, key: MsgKey): string {
  return dict[locale][key] ?? dict.it[key] ?? key;
}
