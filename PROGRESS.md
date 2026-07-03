# PROGRESS — checklist deliverable e requisiti per fase (§0.6, §12)

Checkpoint di macro-fase: a fine fase ri-verificare il codice contro questa
lista e le regole inderogabili (§3), riepilogare fatto/mancante, attendere via.

## FASE 1 — MVP (Node + sidecar Python base)

### Infrastruttura
- [x] Electron + TypeScript + React (electron-vite), UI shadcn/ui + lucide-react
- [x] UDM SQLite in chiaro (better-sqlite3, WAL, busy_timeout), schema/migrazioni owned da Node
- [x] Writer-ownership per tabella (ingestion: sidecar/XML-ingest; applicative: solo Node)
- [x] Handshake `--udm-path` allo spawn del sidecar (Node decide il percorso, Python non fa DDL)
- [x] Throttling eventi IPC di progresso (ThrottledProgress lato Node, ~150ms/100 item lato Python)
- [x] Mai bulk data su IPC (UI paginata; piani di backup trattenuti nel main)
- [x] Sidecar Python: `sidecar.py` (ping / ingest-masterdb / fingerprint), build PyInstaller `--onedir` (sh + ps1)
- [x] Fallback "sidecar non trovato" con messaggio antivirus/quarantena, degrado solo-XML
- [x] electron-builder (dmg/zip · nsis/portable) + GitHub Actions matrix macOS+Windows
- [x] Vitest: 49 test verdi (runner dentro Electron per l'ABI di better-sqlite3)

### Funzionalità
- [x] 1. Backup Smart Incrementale (snapshot DB prima di tutto, diff mtime+size, hash opzionale con verifica)
- [x] 2. Cacciatore File Orfani (diff, spazio recuperabile, quarantena reversibile, doppia conferma "SPOSTA")
- [x] 3. Report Excel (streaming, versione da regex, Camelot, "Manca tag?" in rosso, filtri, totale durata)
- [x] 4. Converter: Rekordbox XML (max 8 hot cue applicato), Traktor NML, VirtualDJ XML; Serato/Engine "in arrivo"
- [x] 5. Relocator base (match per nome file, dry-run, XML di aggiornamento; mai scritture su master.db)
- [x] 6. Encoding: rilevazione (chardet), fix mojibake, vista "Da revisionare", esclusione dagli export
- [x] Modalità solo-XML completa (ingestion collection XML pure-Node)
- [x] Ingestion master.db via pyrekordbox nel sidecar (scrittura diretta in UDM)

### UX (§5, §7)
- [x] Sidebar + 10 pagine, wizard passo-passo con dry-run
- [x] Dark/Light/Auto + toggle, it/en, modalità Semplice/Esperto (voci expertOnly nascoste)
- [x] DangerConfirmDialog (parola chiave + checkbox) per azioni distruttive
- [x] Banner limiti XML non ignorabile prima di ogni export (checkbox di presa visione)
- [x] Messaggi in linguaggio umano, schermata solo-XML con istruzioni
- [x] About con logo placeholder (assets/branding/) e credito TX-Breaker × Rekordbox DJ Italia Group
- [x] Registro operazioni leggibile + export .txt

### Testing (§11)
- [x] Fixture cifrata SOLO via Python (`make_encrypted_fixture.py`, sqlcipher3) — Node mai sul cifrato
- [x] Test UDM su SQLite in chiaro (migrazioni, paginazione, settings, oplog)
- [x] Unit: versionRegex, camelot, encoding/mojibake, ingestion XML, writer XML (limite 8 hot cue), orfani, backup incrementale
- [x] Dry-run testato (backup plan, quarantena)
- [ ] Rollback ID3 — rimandato: la scrittura ID3 è Fase 2 (Serato), il test arriverà col servizio

### Da fare / verifiche residue Fase 1
- [x] Build sidecar su questa macchina (PyInstaller --onedir, binario testato: `ping` ok)
- [x] Test e2e sidecar: handshake --udm-path, degrado pulito su DB incompatibile (44/44 test verdi)
- [x] `npm run dist` locale ok: NSIS Setup + portable in `release/`, sidecar incluso in resources
- [x] Smoke run del pacchetto: CrateForge.exe parte e resta vivo (no crash all'avvio)
- [ ] Test manuale UI umano su tutte le pagine (click-through con dati reali)
- [ ] Ingest end-to-end da un VERO master.db (fixture minima non basta per pyrekordbox ORM: prevista opzione utente §11)
- [x] Istruzioni visive per export/import XML manuale: GuideDialog con schemi
      SVG disegnati (niente screenshot proprietari Pioneer), 4 lingue, 2 guide
      (esporta collection / importa XML in Rekordbox). Agganciata a: Dashboard
      (alert solo-XML + bottone sotto l'import), Converter (esito export),
      Relocator (esito XML)
- [x] Icona applicazione: `build/icon.png` + `icon.ico` generati (crate+vinili+scintilla,
      tema dark/ambra); electron-builder li rileva via buildResources e genera
      l'icns per mac. Rigenerabile: era PIL-script one-shot, il PNG è la fonte

## FASE 2 — AI (modalità Esperto, sperimentale) — CORE FUNZIONANTE
- [x] Dedup per fingerprint: `fingerprint-batch` nel sidecar (acoustic_id = simhash
      Chromaprint a 4 segmenti), pagina Duplicati con quarantena reversibile
      (doppia conferma "SPOSTA"), colonna "Acoustic ID" nel report Excel
- [x] Relocator per fingerprint: `match-fingerprints` (scrive in
      `relocation_matches`, schema UDM v2), sezione dedicata nel Relocator,
      XML di aggiornamento via writer esistente
- [x] Auto-Cue ASSISTITO: `analyze-cues` (aubio onset/energia → intro/drop/
      breakdown/outro, max 8), UI human-in-the-loop (rivedi/sposta/rimuovi,
      salva solo su click; verso Rekordbox sempre via XML). UI waveform: rinviata
      (lista editabile per ora). madmom/essentia/allin1: solo mac/Linux, commentati
      in requirements-ai.txt
- [x] Auto-Tagger MusicBrainz: solo query testuali artista/titolo (mai audio),
      rate-limit 1 req/s + retry con backoff, soglia score ≥90, proposte→revisione→
      apply solo su UDM. Discogs (richiede token): rinviato
- [x] Stems (Demucs) on-demand, cancellabile, degrado pulito se non installato
- [x] Livello AI opzionale: `requirements-ai.txt` separato; senza librerie i comandi
      falliscono con messaggio chiaro in-app, il sidecar base resta intatto
- [x] Test: autoTagger (mock fetch: score, retry 503, offline), migrazione v2
      (49/49 verdi, typecheck pulito)
- [ ] Scrittura ID3 su copia con rollback verificato (Serato) — rinviata a Fase 3
      (richiede serato-connect + safeguard dedicati)
- [x] UI waveform per i cue: il sidecar emette `envelope` RMS normalizzata
      (max 480 bucket, pochi KB — non campioni audio) da `analyze-cues`;
      `Waveform.tsx` la disegna in SVG con marker colorati trascinabili
      (drag → aggiorna positionMs), fallback automatico alla sola lista se
      l'envelope manca. Onestà in UI: nessun ascolto, verifica in Rekordbox.
      Sidecar ricompilato con la modifica
- [ ] Verifica manuale con fpcalc/aubio installati su questa macchina

## FASE INTERMEDIA (post-F3, richieste utente 02/07/2026) — COMPLETATA
- [x] Scritture dirette sui file originali (opt-in): setting Esperto `directWrites`
      con doppio disclaimer; gate anche lato main (non solo UI). Sbloccate:
      eliminazione DEFINITIVA orfani (conferma "ELIMINA") e scrittura tag ID3
      sugli originali via sidecar mutagen (backup per-file verificato con hash,
      rollback automatico, conferma "SCRIVI"). Il master.db resta SEMPRE
      read-only (cifrato, schema non documentato: un errore = libreria persa) —
      motivato in UI
- [x] Visualizzatore Excel in ReportPage: lettura paginata in main (max 500
      righe/colpo), scroll orizzontale, colonne ridimensionabili col mouse,
      larghezze persistite per nome colonna e resettabili
- [x] i18n francese + tedesco (dizionario nav/common/target; DEBITO: i testi
      lunghi delle pagine restano in italiano, vale anche per l'inglese)
- [x] fpcalc (Chromaprint 1.5.1) incluso nel pacchetto: download automatico nei
      build script (ps1+sh), sidecar lo cerca accanto al proprio eseguibile →
      l'utente non installa nulla. Verificato nel pacchetto win-unpacked
- [x] Auto-Cue rifatto: browser della libreria (ricerca o playlist intera),
      abilita/disabilita per brano, analisi batch interrompibile, revisione e
      salvataggio per-brano o "salva tutti"
- [x] Auto-Tagger: provider Discogs (token personale nelle Impostazioni,
      style>genre, retry su 429) accanto a MusicBrainz
- [x] download-key pyrekordbox in-app (§4.3): bottone in Impostazioni (Esperto),
      suggerito anche nel messaggio di errore dell'ingest master.db
- [x] SaveTargetNotice: ogni esito dichiara la destinazione (UDM/copia/XML/
      ORIGINALI) — su Tagger, AutoCue, Dedup, Stems, Converter, Inbox, Relocator
- [x] Stems: dichiarato in UI che Demucs gira 100% in locale, nessun upload
- [x] Bug visivo Alert (titolo sovrapposto all'icona): `[&>svg~*]:pl-7`
- [x] Sidecar ricompilato (write-tags, download-key, fpcalc path); 69/69 test,
      typecheck pulito, dist rigenerato, smoke run ok
- [x] Localizzazione testi di pagina (it/en/fr/de) COMPLETATA su tutte le
      16 pagine: pattern in `lib/i18nPages.ts` (namespace per pagina,
      segnaposto {x}, fallback it). Migrate in 3 blocchi finali:
      Report/Relocator/Review/Log, Dedup/Tagger/Stems/Inbox,
      AutoCue/Planner/Settings/About. Restano in italiano solo i nomi
      propri (playlist "CrateForge – Nuovi Acquisti" nell'XML) e le parole
      chiave delle doppie conferme (SPOSTA/ELIMINA/SCRIVI), identiche in
      tutte le lingue per sicurezza
- [x] Test automatico write-tags: `tests/writeTags.e2e.test.ts` (3 test) con MP3
      minimo VALIDO generato in Python (`tests/fixtures/make_audio_fixture.py`,
      frame MPEG reali + EasyID3). Copre: happy path (backup byte-identico al
      pre-scrittura, tag verificati in rilettura), rollback su file non-audio
      (contenuto intatto, hash uguale), file inesistente (errore pulito).
      Suite: 72/72 verdi

## FUNZIONI EXTRA (proposte in autonomia, 03/07/2026) — COMPLETATE
- [x] Salute libreria (modalità Semplice, read-only): punteggio 0–100 pesato
      (BPM/key 25+25, genere 15, anno 10, review 15, duplicati 10), righe
      "cosa manca → dove sistemarlo" con barre percentuali; solo COUNT SQL,
      niente scansioni filesystem. core/health.ts + HealthPage
- [x] Set Builder (Esperto, read-only): scaletta suggerita da un brano di
      partenza — greedy su regola Camelot + finestra BPM ±6%, curva
      up/flat/down (~±1.5%/passo), bonus stesso genere, malus stesso artista
      di fila, stop onesto con "exhausted" se mancano candidati; export XML
      con playlist "CrateForge – Set Builder" (import manuale, come sempre).
      services/setbuilder + adapters/rekordbox/setXml + SetBuilderPage
- [x] i18n completo per entrambe (namespace health/setbuilder × 4 lingue)
- [x] Test: health (vuota/perfetta/buchi+duplicati), setBuilder (catena
      compatibile senza ripetizioni, exhausted, errore su start senza
      key/BPM) — 78/78 verdi

## FASE 3 — Power user (modalità Esperto) — CORE FUNZIONANTE
- [x] Sync Daemon "Nuovi Acquisti": fs.watch ricorsivo con debounce 2s, scansione
      idempotente (skip file già in coda o in libreria), tag via music-metadata,
      camelot+versione normalizzati, coda `inbox_items` (schema UDM v3, owner Node),
      riavvio automatico se attivo nella sessione precedente. Onestà: attivo solo
      ad app aperta (dichiarato in UI), niente iniezioni nel master.db — genera
      XML con playlist "CrateForge – Nuovi Acquisti" da importare a mano
- [x] Set Planner: analisi read-only delle transizioni (regola Camelot con anello
      12↔1, soglia salto BPM 6%), tracce-ponte compatibili con entrambi i lati e
      BPM intermedio. Limite dichiarato in UI: energia non nel DB, BPM come proxy
- [x] Test: harmony (parse/compatibilità/wrap/transizioni), setPlanner
      (playlist/clash/ponti), syncDaemon (idempotenza/corrotti/skip libreria),
      inboxXml — 63/63 verdi, typecheck pulito
- [x] `npm run dist` rigenerato con Fase 2+3; smoke run del pacchetto ok
- [ ] Daemon come servizio di sistema ad app chiusa — fuori scope volutamente
      (onestà §1: la UI dice "attivo mentre CrateForge è aperto")
- [ ] Proposta cue automatica sugli item della coda (richiede livello AI; per ora
      si usa Auto-Cue dopo l'import)

## Regole inderogabili (§3) — verifica rapida a ogni checkpoint
1. Mai scrivere su originali ✔ (backup/export/quarantena: solo copie o move reversibile)
2. Backup DB+options.json prima di output importabili ✔ (eseguito per primo nel piano)
3. Doppia conferma su azioni distruttive ✔ (DangerConfirmDialog)
4. ID3 su copia con rollback — n/a in Fase 1 (nessuna scrittura ID3 presente)
5. Hash su copie/ripristini ✔ (copyWithVerify)
6. Dry-run di default ✔ (backup plan, quarantena, relocator)
7. Log completo esportabile ✔ (oplog + export txt)
