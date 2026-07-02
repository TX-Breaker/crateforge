import type { Locale } from './i18n';

/**
 * Testi lunghi delle pagine, per pagina e per lingua (debito i18n tracciato
 * in PROGRESS.md). Pattern: ogni pagina ha il suo namespace; le pagine non
 * ancora migrate restano in italiano finché non vengono aggiunte qui.
 *
 * Per migrare una pagina: aggiungi il namespace, poi nella pagina
 *   const tp = usePageText('dashboard');  →  tp('title')
 */

type PageDict = Record<string, Record<string, string>>;

const pages: Record<Locale, PageDict> = {
  it: {
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
    }
  },
  en: {
    dashboard: {
      title: 'Overview',
      subtitle: "CrateForge is your library's mechanic: fix things here, then play in Rekordbox.",
      statTracks: 'Tracks',
      statPlaylists: 'Playlists',
      statReview: 'Needs review',
      xmlOnlyTitle: 'XML-only mode active',
      xmlOnlyBody:
        "The direct Rekordbox database reader is not available on this computer (on Windows the antivirus sometimes quarantines it: check Windows Defender notifications and restore the file, or add the app folder to the exclusions). You can still do everything by exporting the collection as XML from Rekordbox: File → Export Collection in xml format, then import it below.",
      importTitle: 'Import your library',
      importDesc:
        'The library is copied into the internal CrateForge database. Rekordbox files are opened read-only: your originals are never modified.',
      importXmlBtn: 'Import collection XML',
      importDbBtn: 'Read master.db directly',
      lastIngest: 'Last import'
    }
  },
  fr: {
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
    }
  },
  de: {
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
    }
  }
};

export function pageText(locale: Locale, page: string, key: string): string {
  return pages[locale]?.[page]?.[key] ?? pages.it[page]?.[key] ?? key;
}
