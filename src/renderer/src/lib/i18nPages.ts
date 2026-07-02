import type { Locale } from './i18n';

/**
 * Testi lunghi delle pagine, per pagina e per lingua (debito i18n tracciato
 * in PROGRESS.md). Pattern: ogni pagina ha il suo namespace; le pagine non
 * ancora migrate restano in italiano finché non vengono aggiunte qui.
 *
 * Per migrare una pagina (vedi Dashboard.tsx come pilota):
 *   const { locale } = useAppState();
 *   const tp = (k: string, p?: Params) => pageText(locale, 'nomepagina', k, p);
 * I segnaposto {x} vengono sostituiti dai params: tp('done', { n: 3 }).
 */

type Params = Record<string, string | number>;
type PageDict = Record<string, Record<string, string>>;

const pages: Record<Locale, PageDict> = {
  it: {
    common: {
      prev: '← Precedenti',
      next: 'Successivi →',
      pageOf: 'Pagina {p} di {tot}',
      selectAll: 'Seleziona tutti',
      deselectAll: 'Deseleziona',
      warnPrefix: 'ATTENZIONE:'
    },
    dashboard: {
      title: 'Panoramica',
      subtitle: 'CrateForge è il meccanico della tua libreria: sistemi qui, poi suoni in Rekordbox.',
      statTracks: 'Brani',
      statPlaylists: 'Playlist',
      statReview: 'Da revisionare',
      xmlOnlyTitle: 'Modalità solo-XML attiva',
      xmlOnlyBody:
        "Il modulo di lettura diretta del database Rekordbox non è disponibile su questo computer (su Windows capita che l'antivirus lo metta in quarantena: controlla le notifiche di Windows Defender e ripristina il file, oppure aggiungi la cartella dell'app alle esclusioni). Puoi comunque fare tutto esportando la collection in XML da Rekordbox: File → Export Collection in xml format, poi importala qui sotto.",
      importTitle: 'Importa la tua libreria',
      importDesc:
        'La libreria viene copiata nel database interno di CrateForge. I file di Rekordbox vengono aperti in sola lettura: nessuna modifica agli originali, mai.',
      importXmlBtn: 'Importa collection XML',
      importDbBtn: 'Leggi master.db direttamente',
      lastIngest: 'Ultima importazione'
    },
    backup: {
      title: 'Backup Smart Incrementale',
      subtitle: 'Copia il database di Rekordbox e solo i file musicali nuovi o modificati. Secondi, non ore.',
      safeTitle: 'Operazione sicura',
      safeBody: 'Il backup legge soltanto: i tuoi originali non vengono modificati né spostati.',
      step1: '1 · Scegli le cartelle',
      step1Desc:
        'Consiglio: seleziona anche master.db e options.json — options.json serve per poter rileggere il database in futuro.',
      fMusic: 'Cartella musica',
      fBackup: 'Cartella di backup (destinazione)',
      fMasterDb: 'master.db (opzionale ma consigliato)',
      fOptions: 'options.json (opzionale ma consigliato)',
      calc: 'Calcola anteprima',
      step2: '2 · Anteprima (nessun file toccato finora)',
      planLine: 'Scansionati {scanned} file. Da copiare: {toCopy} ({size}).',
      planDb: 'Il database Rekordbox verrà salvato in {dir}.',
      reasonNew: 'nuovo',
      reasonMod: 'modificato',
      more: '… e altri {n} file',
      run: 'Esegui il backup',
      resDone: 'Backup completato: {copied} file copiati',
      resDb: '. Database salvato in {dir}',
      resFail: '. ATTENZIONE: {n} file non copiati.'
    },
    orphans: {
      title: 'Cacciatore di File Orfani',
      subtitle: 'Trova i file audio presenti sul disco ma assenti dalla tua libreria Rekordbox.',
      howTitle: 'Come funziona la quarantena',
      howBody:
        'Di default CrateForge non elimina i file: li sposta in una cartella di quarantena datata, da cui puoi ripristinarli quando vuoi. (L\'eliminazione definitiva esiste solo se attivi le "scritture dirette" nelle Impostazioni, con doppia conferma.) La scansione confronta il disco con la libreria che hai importato: importa prima la libreria dalla Panoramica.',
      step1: '1 · Scansiona la cartella musica',
      fMusic: 'Cartella musica',
      scan: 'Avvia scansione',
      step2: '2 · Risultato',
      resLine: '{scanned} file scansionati, {known} brani in libreria. {orphans} orfani — spazio recuperabile: {space}.',
      none: 'Nessun file orfano: disco e libreria sono allineati. Ottimo lavoro.',
      selCount: '{n} selezionati ({size})',
      fQuarantine: 'Cartella di quarantena (dove spostare i file)',
      moveBtn: 'Sposta in quarantena ({n})',
      delBtn: 'Elimina definitivamente ({n})',
      directNote:
        "L'eliminazione definitiva è attiva perché hai abilitato le scritture dirette nelle Impostazioni. La quarantena resta la strada consigliata: è reversibile.",
      outMoved: 'Spostati in quarantena {moved} file su {tot} (cartella: {dir}).',
      outMovedFail: ' ATTENZIONE: {n} non spostati.',
      outMovedTail: ' Puoi ripristinarli in qualsiasi momento: nessun file è stato eliminato.',
      outDeleted: 'ELIMINATI DEFINITIVAMENTE {n} file ({size} liberati).',
      outDelFail: ' ATTENZIONE: {n} non eliminati.',
      delTitle: 'Eliminare DEFINITIVAMENTE questi file?',
      delLabel: 'Elimina per sempre {n} file',
      delBody1:
        "Stai per eliminare per sempre {n} file ({size}) dai tuoi FILE ORIGINALI. Non c'è cestino, non c'è quarantena, non c'è ritorno.",
      delBody2: 'Se hai anche il minimo dubbio, usa invece la quarantena: fa spazio uguale ma resta reversibile.',
      qTitle: 'Spostare i file in quarantena?',
      qLabel: 'Sposta {n} file',
      qBody1: 'Stai per spostare {n} file ({size}) dalla cartella musica alla quarantena:',
      qBody2:
        'I file NON vengono eliminati e potrai ripristinarli. Se alcuni servono ad altri programmi, escludili prima dalla selezione.'
    },
    converter: {
      title: 'Converti libreria',
      subtitle: 'Esporta la libreria verso altri software DJ. Sempre su file nuovi: gli originali non vengono toccati.',
      fmtRekordbox: 'Per re-import nella collection o per condividere la libreria.',
      fmtTraktor: 'Hot cue, beatgrid e playlist per Traktor Pro.',
      fmtVdj: 'Database XML importabile in VirtualDJ.',
      exportBtn: 'Esporta…',
      comingSoon: 'In arrivo',
      seratoReason: "Export diretto verso Serato in arrivo in una versione futura. Per ora usa l'export Rekordbox XML o il report Excel.",
      engineReason: "Export diretto verso Engine DJ in arrivo in una versione futura. Per ora usa l'export Rekordbox XML o Traktor NML.",
      dlgTitle: 'Prima di esportare: cosa devi sapere',
      limit1: "L'import XML aggiunge/aggiorna i brani ma NON rimuove nulla dalla collection.",
      limit2: 'Vengono importate al massimo 8 hot cue per brano.',
      limit3: 'I colori delle memory cue, i MyTag e le smartlist NON passano.',
      limit4: 'I loop attivi NON passano.',
      limit5: "L'import finale in Rekordbox è manuale: dovrai cliccare tu 'Import to Collection'.",
      dlgNote: 'Questi sono limiti del formato, non di CrateForge: nessun tool può aggirarli.',
      ack: "Ho letto e capito i limiti dell'export",
      proceed: "Continua con l'export",
      outDone: 'Export {fmt} completato: {n} brani in {path}.',
      outRbTail: " Ora apri Rekordbox, imposta questo file in Preferenze → Avanzate → rekordbox xml, poi clicca tu 'Import to Collection': l'import finale è manuale."
    }
  },
  en: {
    common: {
      prev: '← Previous',
      next: 'Next →',
      pageOf: 'Page {p} of {tot}',
      selectAll: 'Select all',
      deselectAll: 'Deselect',
      warnPrefix: 'WARNING:'
    },
    dashboard: {
      title: 'Overview',
      subtitle: "CrateForge is your library's mechanic: fix things here, then play in Rekordbox.",
      statTracks: 'Tracks',
      statPlaylists: 'Playlists',
      statReview: 'Needs review',
      xmlOnlyTitle: 'XML-only mode active',
      xmlOnlyBody:
        'The direct Rekordbox database reader is not available on this computer (on Windows the antivirus sometimes quarantines it: check Windows Defender notifications and restore the file, or add the app folder to the exclusions). You can still do everything by exporting the collection as XML from Rekordbox: File → Export Collection in xml format, then import it below.',
      importTitle: 'Import your library',
      importDesc:
        'The library is copied into the internal CrateForge database. Rekordbox files are opened read-only: your originals are never modified.',
      importXmlBtn: 'Import collection XML',
      importDbBtn: 'Read master.db directly',
      lastIngest: 'Last import'
    },
    backup: {
      title: 'Smart Incremental Backup',
      subtitle: 'Copies the Rekordbox database and only new or changed music files. Seconds, not hours.',
      safeTitle: 'Safe operation',
      safeBody: 'The backup only reads: your originals are never modified or moved.',
      step1: '1 · Choose folders',
      step1Desc:
        'Tip: also select master.db and options.json — options.json is needed to read the database again in the future.',
      fMusic: 'Music folder',
      fBackup: 'Backup folder (destination)',
      fMasterDb: 'master.db (optional but recommended)',
      fOptions: 'options.json (optional but recommended)',
      calc: 'Compute preview',
      step2: '2 · Preview (no file touched yet)',
      planLine: 'Scanned {scanned} files. To copy: {toCopy} ({size}).',
      planDb: 'The Rekordbox database will be saved to {dir}.',
      reasonNew: 'new',
      reasonMod: 'modified',
      more: '… and {n} more files',
      run: 'Run backup',
      resDone: 'Backup complete: {copied} files copied',
      resDb: '. Database saved to {dir}',
      resFail: '. WARNING: {n} files not copied.'
    },
    orphans: {
      title: 'Orphan File Hunter',
      subtitle: 'Finds audio files that are on disk but missing from your Rekordbox library.',
      howTitle: 'How quarantine works',
      howBody:
        'By default CrateForge does not delete files: it moves them into a dated quarantine folder you can restore from at any time. (Permanent deletion only exists if you enable "direct writes" in Settings, with double confirmation.) The scan compares the disk with the library you imported: import your library from the Overview first.',
      step1: '1 · Scan the music folder',
      fMusic: 'Music folder',
      scan: 'Start scan',
      step2: '2 · Result',
      resLine: '{scanned} files scanned, {known} tracks in library. {orphans} orphans — reclaimable space: {space}.',
      none: 'No orphan files: disk and library are aligned. Nice work.',
      selCount: '{n} selected ({size})',
      fQuarantine: 'Quarantine folder (where files are moved)',
      moveBtn: 'Move to quarantine ({n})',
      delBtn: 'Delete permanently ({n})',
      directNote:
        'Permanent deletion is available because you enabled direct writes in Settings. Quarantine remains the recommended path: it is reversible.',
      outMoved: 'Moved {moved} of {tot} files to quarantine (folder: {dir}).',
      outMovedFail: ' WARNING: {n} not moved.',
      outMovedTail: ' You can restore them at any time: no file was deleted.',
      outDeleted: 'PERMANENTLY DELETED {n} files ({size} freed).',
      outDelFail: ' WARNING: {n} not deleted.',
      delTitle: 'Permanently delete these files?',
      delLabel: 'Delete {n} files forever',
      delBody1:
        'You are about to delete {n} files ({size}) from your ORIGINAL FILES, forever. There is no recycle bin, no quarantine, no way back.',
      delBody2: 'If you have even the slightest doubt, use quarantine instead: same space freed, but reversible.',
      qTitle: 'Move files to quarantine?',
      qLabel: 'Move {n} files',
      qBody1: 'You are about to move {n} files ({size}) from the music folder to quarantine:',
      qBody2:
        'Files are NOT deleted and can be restored. If other programs need some of them, exclude them from the selection first.'
    },
    converter: {
      title: 'Convert library',
      subtitle: 'Exports your library to other DJ software. Always into new files: originals are never touched.',
      fmtRekordbox: 'For re-import into the collection or to share the library.',
      fmtTraktor: 'Hot cues, beatgrid and playlists for Traktor Pro.',
      fmtVdj: 'Database XML importable into VirtualDJ.',
      exportBtn: 'Export…',
      comingSoon: 'Coming soon',
      seratoReason: 'Direct export to Serato is coming in a future version. For now use the Rekordbox XML export or the Excel report.',
      engineReason: 'Direct export to Engine DJ is coming in a future version. For now use the Rekordbox XML export or Traktor NML.',
      dlgTitle: 'Before you export: what you need to know',
      limit1: 'The XML import adds/updates tracks but NEVER removes anything from the collection.',
      limit2: 'At most 8 hot cues per track are imported.',
      limit3: 'Memory cue colors, MyTags and smartlists do NOT carry over.',
      limit4: 'Active loops do NOT carry over.',
      limit5: "The final import into Rekordbox is manual: you have to click 'Import to Collection' yourself.",
      dlgNote: 'These are limits of the format, not of CrateForge: no tool can work around them.',
      ack: 'I have read and understood the export limits',
      proceed: 'Continue with the export',
      outDone: '{fmt} export complete: {n} tracks in {path}.',
      outRbTail: " Now open Rekordbox, set this file in Preferences → Advanced → rekordbox xml, then click 'Import to Collection' yourself: the final import is manual."
    }
  },
  fr: {
    common: {
      prev: '← Précédents',
      next: 'Suivants →',
      pageOf: 'Page {p} sur {tot}',
      selectAll: 'Tout sélectionner',
      deselectAll: 'Désélectionner',
      warnPrefix: 'ATTENTION :'
    },
    dashboard: {
      title: "Vue d'ensemble",
      subtitle: 'CrateForge est le mécanicien de votre bibliothèque : réparez ici, puis jouez dans Rekordbox.',
      statTracks: 'Titres',
      statPlaylists: 'Playlists',
      statReview: 'À vérifier',
      xmlOnlyTitle: 'Mode XML seul actif',
      xmlOnlyBody:
        "Le lecteur direct de la base Rekordbox n'est pas disponible sur cet ordinateur (sous Windows, l'antivirus le met parfois en quarantaine : vérifiez les notifications de Windows Defender et restaurez le fichier, ou ajoutez le dossier de l'application aux exclusions). Vous pouvez tout faire quand même en exportant la collection en XML depuis Rekordbox : File → Export Collection in xml format, puis importez-la ci-dessous.",
      importTitle: 'Importez votre bibliothèque',
      importDesc:
        'La bibliothèque est copiée dans la base interne de CrateForge. Les fichiers Rekordbox sont ouverts en lecture seule : vos originaux ne sont jamais modifiés.',
      importXmlBtn: 'Importer la collection XML',
      importDbBtn: 'Lire master.db directement',
      lastIngest: 'Dernier import'
    },
    backup: {
      title: 'Sauvegarde intelligente incrémentale',
      subtitle: 'Copie la base Rekordbox et seulement les fichiers musicaux nouveaux ou modifiés. Des secondes, pas des heures.',
      safeTitle: 'Opération sûre',
      safeBody: 'La sauvegarde ne fait que lire : vos originaux ne sont ni modifiés ni déplacés.',
      step1: '1 · Choisissez les dossiers',
      step1Desc:
        'Conseil : sélectionnez aussi master.db et options.json — options.json est nécessaire pour relire la base à l\'avenir.',
      fMusic: 'Dossier musique',
      fBackup: 'Dossier de sauvegarde (destination)',
      fMasterDb: 'master.db (facultatif mais recommandé)',
      fOptions: 'options.json (facultatif mais recommandé)',
      calc: "Calculer l'aperçu",
      step2: '2 · Aperçu (aucun fichier touché pour l\'instant)',
      planLine: '{scanned} fichiers analysés. À copier : {toCopy} ({size}).',
      planDb: 'La base Rekordbox sera enregistrée dans {dir}.',
      reasonNew: 'nouveau',
      reasonMod: 'modifié',
      more: '… et {n} autres fichiers',
      run: 'Lancer la sauvegarde',
      resDone: 'Sauvegarde terminée : {copied} fichiers copiés',
      resDb: '. Base enregistrée dans {dir}',
      resFail: '. ATTENTION : {n} fichiers non copiés.'
    },
    orphans: {
      title: 'Chasseur de fichiers orphelins',
      subtitle: 'Trouve les fichiers audio présents sur le disque mais absents de votre bibliothèque Rekordbox.',
      howTitle: 'Comment fonctionne la quarantaine',
      howBody:
        "Par défaut CrateForge ne supprime pas les fichiers : il les déplace dans un dossier de quarantaine daté, d'où vous pouvez les restaurer à tout moment. (La suppression définitive n'existe que si vous activez les « écritures directes » dans les Paramètres, avec double confirmation.) L'analyse compare le disque avec la bibliothèque importée : importez d'abord votre bibliothèque depuis la Vue d'ensemble.",
      step1: '1 · Analysez le dossier musique',
      fMusic: 'Dossier musique',
      scan: "Lancer l'analyse",
      step2: '2 · Résultat',
      resLine: '{scanned} fichiers analysés, {known} titres en bibliothèque. {orphans} orphelins — espace récupérable : {space}.',
      none: 'Aucun fichier orphelin : disque et bibliothèque sont alignés. Beau travail.',
      selCount: '{n} sélectionnés ({size})',
      fQuarantine: 'Dossier de quarantaine (où déplacer les fichiers)',
      moveBtn: 'Mettre en quarantaine ({n})',
      delBtn: 'Supprimer définitivement ({n})',
      directNote:
        'La suppression définitive est disponible car vous avez activé les écritures directes dans les Paramètres. La quarantaine reste la voie recommandée : elle est réversible.',
      outMoved: '{moved} fichiers sur {tot} mis en quarantaine (dossier : {dir}).',
      outMovedFail: ' ATTENTION : {n} non déplacés.',
      outMovedTail: ' Vous pouvez les restaurer à tout moment : aucun fichier n\'a été supprimé.',
      outDeleted: 'SUPPRIMÉS DÉFINITIVEMENT : {n} fichiers ({size} libérés).',
      outDelFail: ' ATTENTION : {n} non supprimés.',
      delTitle: 'Supprimer DÉFINITIVEMENT ces fichiers ?',
      delLabel: 'Supprimer {n} fichiers pour toujours',
      delBody1:
        "Vous êtes sur le point de supprimer pour toujours {n} fichiers ({size}) de vos FICHIERS ORIGINAUX. Pas de corbeille, pas de quarantaine, pas de retour.",
      delBody2: 'Au moindre doute, utilisez plutôt la quarantaine : même espace libéré, mais réversible.',
      qTitle: 'Mettre les fichiers en quarantaine ?',
      qLabel: 'Déplacer {n} fichiers',
      qBody1: 'Vous allez déplacer {n} fichiers ({size}) du dossier musique vers la quarantaine :',
      qBody2:
        "Les fichiers ne sont PAS supprimés et pourront être restaurés. Si d'autres programmes en ont besoin, excluez-les d'abord de la sélection."
    },
    converter: {
      title: 'Convertir la bibliothèque',
      subtitle: "Exporte la bibliothèque vers d'autres logiciels DJ. Toujours dans de nouveaux fichiers : les originaux ne sont jamais touchés.",
      fmtRekordbox: 'Pour réimporter dans la collection ou partager la bibliothèque.',
      fmtTraktor: 'Hot cues, beatgrid et playlists pour Traktor Pro.',
      fmtVdj: 'Base XML importable dans VirtualDJ.',
      exportBtn: 'Exporter…',
      comingSoon: 'Bientôt',
      seratoReason: "L'export direct vers Serato arrivera dans une version future. Pour l'instant, utilisez l'export Rekordbox XML ou le rapport Excel.",
      engineReason: "L'export direct vers Engine DJ arrivera dans une version future. Pour l'instant, utilisez l'export Rekordbox XML ou Traktor NML.",
      dlgTitle: "Avant d'exporter : ce qu'il faut savoir",
      limit1: "L'import XML ajoute/met à jour les titres mais ne retire JAMAIS rien de la collection.",
      limit2: 'Au maximum 8 hot cues par titre sont importées.',
      limit3: 'Les couleurs des memory cues, les MyTags et les smartlists ne passent PAS.',
      limit4: 'Les boucles actives ne passent PAS.',
      limit5: "L'import final dans Rekordbox est manuel : c'est vous qui cliquez sur 'Import to Collection'.",
      dlgNote: 'Ce sont des limites du format, pas de CrateForge : aucun outil ne peut les contourner.',
      ack: "J'ai lu et compris les limites de l'export",
      proceed: "Continuer l'export",
      outDone: 'Export {fmt} terminé : {n} titres dans {path}.',
      outRbTail: " Ouvrez maintenant Rekordbox, définissez ce fichier dans Préférences → Avancées → rekordbox xml, puis cliquez vous-même sur 'Import to Collection' : l'import final est manuel."
    }
  },
  de: {
    common: {
      prev: '← Zurück',
      next: 'Weiter →',
      pageOf: 'Seite {p} von {tot}',
      selectAll: 'Alle auswählen',
      deselectAll: 'Abwählen',
      warnPrefix: 'ACHTUNG:'
    },
    dashboard: {
      title: 'Übersicht',
      subtitle: 'CrateForge ist der Mechaniker deiner Bibliothek: hier reparieren, dann in Rekordbox auflegen.',
      statTracks: 'Titel',
      statPlaylists: 'Playlists',
      statReview: 'Zu überprüfen',
      xmlOnlyTitle: 'Nur-XML-Modus aktiv',
      xmlOnlyBody:
        'Der direkte Rekordbox-Datenbankleser ist auf diesem Computer nicht verfügbar (unter Windows stellt ihn der Virenschutz manchmal unter Quarantäne: prüfe die Windows-Defender-Benachrichtigungen und stelle die Datei wieder her, oder füge den App-Ordner zu den Ausnahmen hinzu). Du kannst trotzdem alles erledigen, indem du die Collection aus Rekordbox als XML exportierst: File → Export Collection in xml format, dann unten importieren.',
      importTitle: 'Importiere deine Bibliothek',
      importDesc:
        'Die Bibliothek wird in die interne CrateForge-Datenbank kopiert. Rekordbox-Dateien werden nur lesend geöffnet: deine Originale werden nie verändert.',
      importXmlBtn: 'Collection-XML importieren',
      importDbBtn: 'master.db direkt lesen',
      lastIngest: 'Letzter Import'
    },
    backup: {
      title: 'Intelligentes inkrementelles Backup',
      subtitle: 'Kopiert die Rekordbox-Datenbank und nur neue oder geänderte Musikdateien. Sekunden, nicht Stunden.',
      safeTitle: 'Sichere Operation',
      safeBody: 'Das Backup liest nur: deine Originale werden weder verändert noch verschoben.',
      step1: '1 · Ordner wählen',
      step1Desc:
        'Tipp: Wähle auch master.db und options.json — options.json wird gebraucht, um die Datenbank später wieder zu lesen.',
      fMusic: 'Musikordner',
      fBackup: 'Backup-Ordner (Ziel)',
      fMasterDb: 'master.db (optional, empfohlen)',
      fOptions: 'options.json (optional, empfohlen)',
      calc: 'Vorschau berechnen',
      step2: '2 · Vorschau (noch keine Datei angefasst)',
      planLine: '{scanned} Dateien gescannt. Zu kopieren: {toCopy} ({size}).',
      planDb: 'Die Rekordbox-Datenbank wird gespeichert unter {dir}.',
      reasonNew: 'neu',
      reasonMod: 'geändert',
      more: '… und {n} weitere Dateien',
      run: 'Backup ausführen',
      resDone: 'Backup abgeschlossen: {copied} Dateien kopiert',
      resDb: '. Datenbank gespeichert unter {dir}',
      resFail: '. ACHTUNG: {n} Dateien nicht kopiert.'
    },
    orphans: {
      title: 'Jäger verwaister Dateien',
      subtitle: 'Findet Audiodateien, die auf der Festplatte liegen, aber in deiner Rekordbox-Bibliothek fehlen.',
      howTitle: 'So funktioniert die Quarantäne',
      howBody:
        'Standardmäßig löscht CrateForge keine Dateien: Es verschiebt sie in einen datierten Quarantäne-Ordner, aus dem du sie jederzeit wiederherstellen kannst. (Endgültiges Löschen gibt es nur, wenn du in den Einstellungen die „direkten Schreibzugriffe" aktivierst, mit doppelter Bestätigung.) Der Scan vergleicht die Festplatte mit der importierten Bibliothek: Importiere zuerst deine Bibliothek über die Übersicht.',
      step1: '1 · Musikordner scannen',
      fMusic: 'Musikordner',
      scan: 'Scan starten',
      step2: '2 · Ergebnis',
      resLine: '{scanned} Dateien gescannt, {known} Titel in der Bibliothek. {orphans} verwaiste — freigebbarer Speicher: {space}.',
      none: 'Keine verwaisten Dateien: Festplatte und Bibliothek sind synchron. Gute Arbeit.',
      selCount: '{n} ausgewählt ({size})',
      fQuarantine: 'Quarantäne-Ordner (wohin verschoben wird)',
      moveBtn: 'In Quarantäne verschieben ({n})',
      delBtn: 'Endgültig löschen ({n})',
      directNote:
        'Endgültiges Löschen ist verfügbar, weil du direkte Schreibzugriffe in den Einstellungen aktiviert hast. Die Quarantäne bleibt der empfohlene Weg: sie ist umkehrbar.',
      outMoved: '{moved} von {tot} Dateien in Quarantäne verschoben (Ordner: {dir}).',
      outMovedFail: ' ACHTUNG: {n} nicht verschoben.',
      outMovedTail: ' Du kannst sie jederzeit wiederherstellen: keine Datei wurde gelöscht.',
      outDeleted: 'ENDGÜLTIG GELÖSCHT: {n} Dateien ({size} freigegeben).',
      outDelFail: ' ACHTUNG: {n} nicht gelöscht.',
      delTitle: 'Diese Dateien ENDGÜLTIG löschen?',
      delLabel: '{n} Dateien für immer löschen',
      delBody1:
        'Du bist dabei, {n} Dateien ({size}) für immer aus deinen ORIGINALDATEIEN zu löschen. Kein Papierkorb, keine Quarantäne, kein Zurück.',
      delBody2: 'Beim geringsten Zweifel nutze stattdessen die Quarantäne: gleicher Platzgewinn, aber umkehrbar.',
      qTitle: 'Dateien in Quarantäne verschieben?',
      qLabel: '{n} Dateien verschieben',
      qBody1: 'Du verschiebst {n} Dateien ({size}) vom Musikordner in die Quarantäne:',
      qBody2:
        'Die Dateien werden NICHT gelöscht und können wiederhergestellt werden. Falls andere Programme einige davon brauchen, nimm sie vorher aus der Auswahl.'
    },
    converter: {
      title: 'Bibliothek konvertieren',
      subtitle: 'Exportiert die Bibliothek zu anderer DJ-Software. Immer in neue Dateien: Originale werden nie angefasst.',
      fmtRekordbox: 'Für den Re-Import in die Collection oder zum Teilen der Bibliothek.',
      fmtTraktor: 'Hot Cues, Beatgrid und Playlists für Traktor Pro.',
      fmtVdj: 'In VirtualDJ importierbare Datenbank-XML.',
      exportBtn: 'Exportieren…',
      comingSoon: 'Bald verfügbar',
      seratoReason: 'Direkter Export zu Serato kommt in einer künftigen Version. Nutze vorerst den Rekordbox-XML-Export oder den Excel-Bericht.',
      engineReason: 'Direkter Export zu Engine DJ kommt in einer künftigen Version. Nutze vorerst den Rekordbox-XML-Export oder Traktor NML.',
      dlgTitle: 'Vor dem Export: das musst du wissen',
      limit1: 'Der XML-Import fügt Titel hinzu/aktualisiert sie, entfernt aber NIE etwas aus der Collection.',
      limit2: 'Höchstens 8 Hot Cues pro Titel werden importiert.',
      limit3: 'Memory-Cue-Farben, MyTags und Smartlists kommen NICHT mit.',
      limit4: 'Aktive Loops kommen NICHT mit.',
      limit5: "Der finale Import in Rekordbox ist manuell: du musst selbst auf 'Import to Collection' klicken.",
      dlgNote: 'Das sind Grenzen des Formats, nicht von CrateForge: kein Tool kann sie umgehen.',
      ack: 'Ich habe die Export-Grenzen gelesen und verstanden',
      proceed: 'Mit dem Export fortfahren',
      outDone: '{fmt}-Export abgeschlossen: {n} Titel in {path}.',
      outRbTail: " Öffne jetzt Rekordbox, hinterlege diese Datei unter Einstellungen → Erweitert → rekordbox xml und klicke selbst auf 'Import to Collection': der finale Import ist manuell."
    }
  }
};

export function pageText(locale: Locale, page: string, key: string, params?: Params): string {
  let s = pages[locale]?.[page]?.[key] ?? pages.it[page]?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
