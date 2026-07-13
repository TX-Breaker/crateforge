{
  "summary": "Analizza il codice CrateForge e ricerca i formati delle librerie DJ per la conversione bidirezionale",
  "agentCount": 14,
  "logs": [],
  "result": {
    "plan": "# PIANO OPERATIVO CrateForge\n\n## 1. TOP FIX DEL CODICE (max 10, per impatto)\n\n1. **NFC/NFD su macOS — falsi orfani e relocate mancati** — `services/orphans/orphanFinder.ts:27` + `services/relocator/relocator.ts:57` + `services/watcher/syncDaemon.ts:134`. `canon()` non normalizza Unicode: ogni traccia con accenti (Beyoncé, Über) diventa falso orfano e, combinata con quarantena/delete, l'utente cancella file validi. **Fix unico:** funzione condivisa `canonicalizeName()` in `fsutil.ts` (`normalize().normalize('NFC').toLowerCase()`) usata dai tre servizi. È il rischio dati #1 sul target macOS.\n\n2. **Quarantena sovrascrive file omonimi** — `services/orphans/orphanFinder.ts:94`. `fs.rename` sovrascrive la destinazione (POSIX e libuv/Windows): due orfani con stesso basename → il secondo distrugge il primo, log \"ok\" per entrambi; il ramo `EEXIST` è codice morto. **Fix:** `copyFile` con `COPYFILE_EXCL` / `open 'wx'` e suffisso incrementale finché il path è libero; errore esplicito se il loop si esaurisce (mai `moved++` a vuoto).\n\n3. **Gate scritture auto-annullabile via IPC** — `main/ipc.ts:57`. `settings:set` accetta chiavi arbitrarie incluse `directWrites`/`masterDbWrites`; un renderer compromesso le abilita e poi chiama `orphans:delete`. Il gate \"anche nel main\" è inefficace. **Fix:** blocklist di quelle chiavi in `settings:set`, canale dedicato `security:enableDirectWrites` con `dialog.showMessageBox` di conferma **nel main**.\n\n4. **`orphans:delete` accetta path arbitrari dal renderer** — `main/ipc.ts:282`. Nessuna verifica che i file siano davvero orfani rilevati da uno scan. **Fix:** pattern `scanId` (come `backupPlans`): `orphans:scan` salva il risultato nel main, `delete` accetta `(scanId, indici)` e opera solo su path salvati.\n\n5. **`win()` crasha / concorrenza job sull'UDM** — `main/ipc.ts:54` e `:436`. `getAllWindows()[0]` è `undefined` dopo chiusura finestra su macOS → `TypeError` in ~10 handler; inoltre solo l'ingestion rispetta `ingestionRunning`, mentre dedup/cues/tagger/stems/masterdb spawnano sidecar concorrenti → `SQLITE_BUSY` tra Node e Python. **Fix:** `BrowserWindow.fromWebContents(e.sender)` + coda unica `withJobLock(fn)` con `Map<jobId, cancel>` (risolve anche la race su `currentCancel` a `:424`).\n\n6. **MUSICAL_KEY Traktor scritto come testo** — `adapters/traktor/nmlWriter.ts:52`. Traktor vuole l'indice 0-23; il proprio reader fa `Number('Am')→NaN→null`: la key si perde perfino nel round-trip CrateForge→CrateForge. **Fix:** modulo condiviso `traktorKeys.ts` con mappa inversa, scrivere indice in `MUSICAL_KEY@VALUE` e testo in `INFO@KEY`.\n\n7. **`pathToLocation` codifica il drive letter** — `adapters/common.ts:92`. `C:`→`C%3A`, Rekordbox non risolve i file su Windows. **Fix:** non codificare il primo segmento se matcha `/^[A-Za-z]:$/`; test round-trip `pathToLocation`↔`locationToPath`.\n\n8. **`existsSync` sincrono su main per 50k tracce** — `services/relocator/relocator.ts:39`. UI congelata per l'intera scansione; su volume di rete scollegato può bloccare per minuti senza cancel. **Fix:** `fs.promises.access` con concorrenza limitata (32), pre-check delle root di volume, supporto AbortSignal.\n\n9. **`readReportPage` ri-parsa l'intero .xlsx a ogni pagina** — `services/excel/reportViewer.ts:34`. 50k righe = centinaia di MB e secondi per ogni cambio pagina da 500. **Fix:** cache LRU del workbook (chiave `path+mtime`) o `WorkbookReader` stream con skip fino a offset.\n\n10. **Perdita brani nelle playlist ingerite dal master.db** — `python-sidecar/sidecar.py:380`. `seq = _get('TrackNo','Seq') or 0` collassa a 0 e `INSERT OR REPLACE` su PK `(playlist_id, position)` fa sopravvivere un solo brano. **Fix:** fallback all'indice di enumerazione, `position = idx` progressivo ordinando per seq.\n\n**Bonus alto valore (sidecar):** `cmd_stems:874` — `sys.executable -m demucs` è rotto in build PyInstaller frozen (`sidecar -m demucs`); funziona solo in dev. Rilevare `sys.frozen` e invocare demucs in-process o fallire con messaggio chiaro.\n\n---\n\n## 2. MIGLIORIE UX/UI (max 12)\n\n1. **Stato di lavoro non distrutto al cambio pagina** — `App.tsx:138`. Routing per smontaggio: andare al Registro e tornare cancella scan orfani, batch Auto-Cue di minuti, piano backup, scaletta. **Fix:** pagine montate con `display:none` o risultati in store per-pagina; in alternativa conferma di navigazione con lavoro non salvato.\n\n2. **Scoperta modalità Esperto** — `App.tsx` sidebar + `HealthPage.tsx:44`. 8 pagine invisibili in Semplice; gli hint della pagella (\"→ Auto-Tagger\") sono testo morto. **Fix:** voci bloccate con icona lucchetto + tooltip che rimanda alle Impostazioni; hint della Health cliccabili via `navigate(page)` da context. Aggiornare anche `i18nPages settings.expertDesc` (dichiara 3 funzioni, ne sblocca 8).\n\n3. **i18n rotto su 3 componenti** — `JobProgress.tsx:24`, `ExcelViewer.tsx:92`, `Dashboard.tsx:52/56/104`. Etichette fase e `toLocaleString('it-IT')` hardcoded in italiano per utenti EN/FR/DE. **Fix:** spostare in `i18nPages` (namespace `jobs`/`common`), usare il locale attivo per i numeri.\n\n4. **Dashboard import senza catch** — `Dashboard.tsx:73`. `importForeign`/`importMasterDb` hanno `try/finally` senza `catch`: errore IPC → barra sparisce, nessun messaggio. **Fix:** `catch` con `setMessage({kind:'error'})` come già in `importXml`.\n\n5. **Dedup lista stantia + no Stop** — `DedupPage.tsx:85`. I file spostati restano in lista, riselezionabili → seconda operazione fallisce; il run non ha bottone annulla. **Fix:** filtrare i path spostati (come Orphans), aggiungere `jobs.cancel`.\n\n6. **\"Seleziona tutti\" ambiguo negli Orphans** — `OrphansPage.tsx:94`. Seleziona migliaia di file di cui l'utente vede 100. **Fix:** sdoppiare \"Seleziona pagina\" / \"Seleziona tutti ({N})\", ripetere il totale nel `DangerConfirmDialog`, ordinamento per dimensione/cartella.\n\n7. **Onboarding primo avvio** — `Dashboard.tsx` con `stats.tracks===0`. Oggi tre \"—\" e nessuna guida. **Fix:** wizard a 2 scelte (\"leggi master.db\" se sidecar ok / \"esporta XML\" con `GuideDialog` aperto).\n\n8. **Anteprima mancante nel Relocator FP** — `RelocatorPage.tsx:166`. Bottone dipende da `newRoot` (dipendenza nascosta), dry-run mostra solo conteggi contro la filosofia anteprima-prima-di-confermare. **Fix:** `PathField` proprio sulla card FP + anteprima paginata dei match/ambigui.\n\n9. **Converter: presa visione persa** — `ConverterPage.tsx:133`. Chiude il dialog limiti prima del picker; se annulli rifai tutto. **Fix:** tenere il dialog o ricordare l'acknowledgment per formato nella sessione; disabilitare export se `stats.tracks===0`.\n\n10. **LogPage/Tagger senza feedback** — `LogPage.tsx:45` (export senza esito), `TaggerPage.tsx:79` (`doApplyUdm` senza try/catch né busy, doppio click, proposte tutte pre-spuntate). **Fix:** Alert esito con percorso, `try/catch`+busy, select/deselect all, link alle Impostazioni quando Discogs manca token.\n\n11. **BackupPage: nessuna persistenza percorsi** — `BackupPage.tsx:28`. 4 picker ripetuti ogni sessione per un flusso ricorrente. **Fix:** salvare gli ultimi path in settings e precompilarli; validare `backupDir` non dentro `musicDir`.\n\n12. **ReviewPage vicolo cieco** — `ReviewPage.tsx:62`. Tabella read-only senza azioni. **Fix:** azioni per riga (mostra nel file manager, invia ad Auto-Tagger), `review_reason` mappato su chiavi i18n.\n\n**Refactor trasversale (abilita quanto sopra):** estrarre `<Pager/>`, `<OutcomeAlerts/>`, `<TrackLine/>`, `PathField` in `components/`; hook `useAsyncAction` (busy+try/catch — le pagine senza catch sono proprio quelle che l'hanno scritto a mano) e `useSelectionSet`; context `navigate(page)` per la navigazione incrociata.\n\n---\n\n## 3. CONVERSIONE BIDIREZIONALE\n\n### Matrice READ/WRITE per software\n\n| Software | READ (→UDM) | WRITE (UDM→) | Sidecar? |\n|---|---|---|---|\n| **Rekordbox** | **Media→Difficile.** XML: facile (già in `core/xmlCollection.ts`). master.db: SQLCipher, via pyrekordbox → **sidecar**. Cue/beatgrid ad alta risoluzione sono nei file ANLZ (.DAT/.EXT), non nel db. **Perde:** ANLZ non letti (grid fine, waveform), MyTag, smartlist. | **Facile via XML** (percorso ufficiale non distruttivo). master.db diretto **rischioso** (già implementato, gated). **Perde:** loop attivi, colore memory cue (limite XML), MyTag. | Sì per master.db; No per XML |\n| **Traktor** | **Facile.** NML XML in chiaro (`nmlReader.ts` esiste). **Perde oggi:** RANKING/rating, COMMENT, playcount, grid anchor (TYPE 4 scartato), colori cue (assenti nel formato). | **Media.** NML (`nmlWriter.ts`), ma bug key testo (fix #6), playlist piatte, no cartelle, no memory cue, UUID fasulli. **Perde:** grid dinamica (un solo BPM per traccia). | No (XML in Node) |\n| **Serato** | **Difficile.** Nessun reader oggi (unico gap totale). DB `database V2` + `.crate` binari TLV big-endian; cue/beatgrid nei tag GEOB base64 dentro i file audio (mutagen). **Consigliato sidecar Python** (serato-tags/Holzhaus più semplice in Python). | **Difficile/Fase 2.** Riscrittura tag GEOB + `.crate`, solo su copia con backup. **Preserva** byte reserved copiandoli dall'originale. | Sì (mutagen + parsing binario) |\n| **Engine DJ** | **Media.** m.db SQLite in chiaro (`engineReader.ts` esiste, metadati/playlist). **Perde oggi:** cue/loop/beatgrid nei BLOB `PerformanceData` (zlib+qCompress, prefisso lunghezza 8B big-endian, loops non compresso) NON decodificati; ordine playlist via linked-list `nextEntityId` (bug ternario inerte `:127`). | **Difficile/Fase 2.** Stub oggi. Scrittura su DB separato in `Database2/` con ATTACH, mai alterare lo schema (Engine rifiuta il db). Chiave naturale `(originDatabaseUuid, originTrackId)`. | Sì consigliato (BLOB + zlib) |\n| **VirtualDJ** | **Facile-Media.** `database.xml` (`vdjReader.ts` esiste). **Perde oggi:** playlist (sono file `.vdjfolder`/`.m3u` separati — 0 importate), UserColor, rating. BPM = 60/`Scan.Bpm`. | **Media.** `database.xml` (`vdjWriter.ts`), solo hot cue oggi. **Perde:** loop, memory, `Infos@SongLength`, playlist. **Vincolo:** indentazione rigida (1 spazio Song, 2 figli) o \"db corrotto\"; VDJ chiuso. | No (XML in Node); loop/beatgrid semplici |\n\n### Architettura consigliata (hub-and-spoke attorno all'UDM)\n\n**Interfaccia adapter unificata** (elimina le if-catena in `ipc.ts:124/312`):\n```\ntype DjAdapter = {\n  source: TrackSource\n  read?(path): Promise<ForeignLibrary>       // → NormTrack/NormCue/NormPlaylist\n  write?(db, out, sel): Promise<ExportResult> // con warnings[] strutturati\n  status: { available: boolean; readable; writable }\n}\n```\nRegistry unico; ogni writer restituisce `warnings` (cue scartati, campi persi) mostrati in UI come `REKORDBOX_XML_LIMITS`. Spostare l'import Rekordbox da `core/xmlCollection.ts` a `adapters/rekordbox/xmlReader.ts` che produce `ForeignLibrary`, così tutti e 5 i formati sono simmetrici e riusano `importForeignLibrary` (dedup + warning).\n\n**Modello neutro (già `foreignImport.ts`, da estendere):**\n- **Cue:** enum unico `cue|hotcue|memory|loop|fadein|fadeout|load|grid`; posizioni sempre in **ms assoluti**; separare hot da memory (solo Rekordbox ha entrambi). Preservare `color` in import (VDJ `Poi@Color`, Serato Markers2 lo hanno; Traktor no).\n- **Beatgrid:** nuova tabella `beatgrids(track_id, anchor_ms, bpm, beat_index, metro)`. Import da Traktor `CUE_V2 TYPE=4`+`TEMPO`, Serato BeatGrid, Engine `beatData`; export Rekordbox come elementi `TEMPO`, Traktor come `CUE_V2 TYPE=4`. Attenzione **offset MP3 ~26ms** (compensazione come dj-data-converter).\n- **Rating/Color:** **schema UDM v5** (vedi sotto) — oggi `tracks` non ha `rating`/`color`, quindi non possono MAI fluire benché tutti i 5 software li abbiano.\n- **Key:** pivot **Camelot** (già `camelot.ts`); Traktor Open Key ↔ Camelot shift fisso, gestire enarmonie.\n- **Path relocation cross-OS:** normalizzatore centrale — Traktor `DIR '/:'`+`VOLUME`, Engine relativo alla root, Rekordbox `file://localhost/` URL-encoded (drive letter NON codificato, fix #7), VDJ/Serato assoluti. Riscrivere base-path, gestire drive-letter Windows ↔ nome volume macOS (`/Volumes/X`).\n\n---\n\n## 4. NUOVE FUNZIONI REKORDBOX (master.db scrivibile)\n\nSfruttando l'infra sidecar + pyrekordbox già presente:\n\n1. **Ingest cue/beatgrid dal master.db** — oggi `ingest-masterdb` legge solo metadati/playlist. Leggere `DjmdCue` (hot/memory/loop, `Kind`, `InMsec/OutMsec`, `Color`, `Comment`) → tabella `cues` UDM. È il dato più prezioso dopo i metadati. Poi ANLZ (`PQTZ`) per beatgrid fine.\n\n2. **Scrittura cue/hot cue nel master.db** — estendere `masterdb-create-playlist` con `masterdb-write-cues`: proporre auto-cue (già calcolate da `analyze-cues`) e scriverle direttamente, gated + backup + Rekordbox chiuso. **Nota:** per MP3 VBR il calcolo `InMpegAbs/InMpegFrame` è irrisolto in pyrekordbox → cue possibilmente spostate, avvisare in UI.\n\n3. **Rating/Color/Comment/MyTag write-back** — con schema v5, scrivere `DjmdContent.Rating` (0/51/.../255), `ColorID`→`DjmdColor`, `Commnt`, e MyTag via `DjmdMyTag`/`DjmdSongMyTag` (assenti dall'XML, solo db).\n\n4. **Sync playlist bidirezionale** — oggi solo `create_playlist`. Aggiungere update/riordino playlist esistenti nel master.db mantenendo `Seq`/`ParentID`.\n\n5. **Estrazione campi Rekordbox oggi persi** in `_content_to_track`: `Rating`, `ColorID`, `Commnt`, `DJPlayCount`, `StockDate`/created_at, `Remixer`, `Label` — alimentano Health e Set Planner.\n\n6. **Handshake versione** — aggiungere a `ping` la versione sidecar + pyrekordbox; `open_udm` verifica `meta.schema_version` in range supportato (`sidecar.py:158`) per fallire al bootstrap, non a metà ingest.\n\n---\n\n## 5. PIANO DI IMPLEMENTAZIONE (blocchi committabili)\n\nOgni blocco = commit isolato + test. Guardrail invariati: mai scrivere su originali senza opt-in, backup pre-scrittura, doppie conferme, dry-run, oplog.\n\n**FASE 0 — Sicurezza dati e stabilità (nessuna nuova dipendenza)**\n- B0.1 `fsutil.canonicalizeName()` NFC + adozione in orphans/relocator/syncDaemon + test filename NFD. *(fix #1)*\n- B0.2 Quarantena anti-collisione con `COPYFILE_EXCL`/suffisso + test due omonimi. *(fix #2)*\n- B0.3 Gate settings: blocklist + canale `security:enableDirectWrites` con dialog nativo. *(fix #3)*\n- B0.4 `orphans:scan`→`scanId`, `delete` per indici. *(fix #4)*\n- B0.5 `BrowserWindow.fromWebContents` in tutti gli handler + `withJobLock` + `Map<jobId,cancel>`. *(fix #5)*\n- Dip: nessuna. Test: orphans, relocator (nuovo `tests/relocator.test.ts` — oggi **zero** copertura su feature che riscrive path).\n\n**FASE 1 — Correttezza adapter esistenti + round-trip (nessuna nuova dipendenza)**\n- B1.1 `traktorKeys.ts` mappa inversa + `nmlWriter` key indice. *(fix #6)*\n- B1.2 `pathToLocation` drive-letter + test round-trip. *(fix #7)*\n- B1.3 Traktor: memory cue, hot senza index, cartelle playlist, VOLUME POSIX, UUID reali.\n- B1.4 VDJ: `Infos@SongLength`, loop export, playlist reader da `.vdjfolder`.\n- B1.5 Rekordbox writer: `Kind` da estensione, loop `POSITION_MARK Type=4`.\n- B1.6 Sidecar `sidecar.py:380` playlist position fallback. *(fix #10)*\n- Dip: nessuna. Test: **fixture NML/XML reali** in `tests/`, test write→read→confronta per Traktor e VDJ (avrebbe intercettato key-testo, SongLength, `C%3A`).\n\n**FASE 2 — Schema UDM v5 + adapter interface**\n- B2.1 Migrazione v5: `tracks.rating/color/comment/track_number` + tabella `beatgrids` + indice `idx_tracks_camelot_bpm`. `PRAGMA foreign_key_check` post-migrazione. Aggiornare `TrackSource` come tipo condiviso.\n- B2.2 `DjAdapter` interface + registry; refactor `ipc.ts` export/import.\n- B2.3 Rekordbox reader spostato in `adapters/rekordbox/xmlReader.ts`→`ForeignLibrary`.\n- B2.4 Mapping rating/color end-to-end nei reader/writer esistenti (RB XML, Traktor RANKING, VDJ UserColor, Engine rating).\n- Dip: nessuna. Test: parità mapping, migrazione idempotente.\n\n**FASE 3 — Performance e affidabilità servizi**\n- B3.1 Relocator async con concorrenza + cancel. *(fix #8)*\n- B3.2 Report viewer cache LRU / stream. *(fix #9)*\n- B3.3 Export Excel: single `iterate()` senza paginazione, ordine playlist per `pt.position`, try/finally con cleanup file parziale.\n- B3.4 Set builder/planner: usare indice camelot+bpm, `ORDER BY ABS(bpm-target)` prima del LIMIT.\n- B3.5 syncDaemon: stabilità file (stat x2), insert in batch, canonicalizzazione path.\n- Dip: valutare `chokidar` (`awaitWriteFinish`) per B3.5 — **nuova dip**. FTS5 per ricerca libreria è opzionale/futuro.\n\n**FASE 4 — Ingest cue/beatgrid Rekordbox + Engine BLOB**\n- B4.1 Sidecar: `ingest-masterdb` legge `DjmdCue` → tabella `cues`; campi RB estesi.\n- B4.2 Sidecar: ANLZ `PQTZ`/`PCO2` per beatgrid + hot cue >3.\n- B4.3 Engine reader: decodifica `beatData`/`quickCues`/`loops` (zlib+qCompress) + ordine playlist via `nextEntityId`. *(bug `engineReader.ts:127`)*\n- Dip: `pyrekordbox` già presente; zlib stdlib. Test: **pytest nel sidecar** (oggi 962 righe, 3/9 comandi coperti) partendo da `analyze-cues`/`ingest`; fixture da `make_audio_fixture.py`.\n\n**FASE 5 — Serato (gap più grande) + Engine writer**\n- B5.1 Sidecar `ingest-serato`: `database V2` + `.crate` (TLV big-endian, UTF-16 BE) + GEOB Markers2/BeatGrid dai file audio.\n- B5.2 Serato writer Fase 2: solo su copia + backup, preservare byte reserved.\n- B5.3 Engine writer su DB separato in `Database2/` (ATTACH, mai alterare schema).\n- Dip: **mutagen** già bundled; riferimenti `serato-tags`/`libdjinterop`. Rischio alto → dietro flag \"in arrivo\"/opt-in.\n\n**FASE 6 — Nuove funzioni Rekordbox write + hardening**\n- B6.1 `masterdb-write-cues` + rating/color/MyTag write-back (gated, backup, RB chiuso, avviso MP3 VBR).\n- B6.2 Sidecar: payload bulk via file temporaneo/stdin (non argv — limite 32KB Windows), tree-kill con escalation per cancel, `masterdb-create-playlist` con check processo Rekordbox + nome duplicato.\n- B6.3 Handshake versione (`ping` + `open_udm` schema range).\n- Dip: nessuna.\n\n**FASE 7 — Toolchain/CI (parallelizzabile)**\n- Trigger `pull_request` + step `typecheck` + `concurrency`; verifica artefatto (`fpcalc`/sidecar presenti, oggi solo warning); matrice `macos-13` (x64) + `macos-latest` (arm64); cache pip/electron; coverage v8 con soglia; test parità chiavi i18n (~20 righe); test contratto canali preload↔ipc; `*.tsbuildinfo` in `.gitignore`.\n- Dip: `@vitest/coverage-v8` — nuova devDep.\n\n**Dipendenze/toolchain nuove:** `chokidar` (opzionale F3), `@vitest/coverage-v8` (F7), pytest nel sidecar (F4), eventuale FTS5 (futuro). Tutto il resto riusa `pyrekordbox`/`mutagen`/`better-sqlite3` già pinnati.\n\n**Ordine critico:** F0→F1→F2 sono prerequisiti duri (sicurezza, correttezza, schema). F3 indipendente. F4 richiede F2 (tabelle cue/beatgrid). F5 richiede F2+F4. F6 richiede F2. F7 in parallelo da subito.\n\nPercorsi chiave: `crateforge/src/core/{schema,udm,foreignImport}.ts`, `crateforge/src/adapters/`, `crateforge/src/services/{orphans,relocator,watcher,excel}/`, `crateforge/src/main/{ipc,sidecar,index}.ts`, `crateforge/python-sidecar/sidecar.py`, `crateforge/src/renderer/src/{App.tsx,pages/,components/}`.",
    "codeMaps": [
      {
        "subsystem": "CORE di CrateForge — livello dominio puro (senza dipendenze Electron/UI): schema e accesso al database UDM (Universal Data Model, SQLite via better-sqlite3), conversione tonalità→Camelot, analisi armonica per il Set Planner, pagella \"salute libreria\" e estrazione etichette versione. Modello dati UDM (v4): meta (versioning schema), tracks (hub universale dei brani, UNIQUE(source,source_id), dal v4 senza CHECK per accettare source masterdb/xml/traktor/virtualdj/engine/serato), playlists (albero con parent_id self-FK CASCADE), playlist_tracks (PK playlist_id+position), cues (hot/memory/loop, FK CASCADE su tracks), ingest_runs, relocation_matches (v2, UNIQUE track_id+method), inbox_items (v3, coda Nuovi Acquisti), settings/jobs/oplog. Ownership scrittura: DDL e migrazioni SOLO Node; tabelle ingestion (tracks, playlists, playlist_tracks, cues, ingest_runs, relocation_matches) scritte dal sidecar Python per master.db e da Node per il fallback XML/import foreign (serializzati, mai concorrenti); settings/jobs/oplog/inbox_items SOLO Node. Convivenza multi-processo via WAL + busy_timeout 5000.",
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "role": "Owner dello schema UDM: SCHEMA_VERSION=4, mappa MIGRATIONS per-versione applicate in transazioni singole da migrate(); getSchemaVersion() legge meta.schema_version. v1 crea il modello base, v2 relocation_matches, v3 inbox_items, v4 ricostruisce tracks/playlists senza CHECK su source (workaround al limite SQLite sull'ALTER dei CHECK), con FK OFF per non innescare CASCADE sui figli durante il DROP."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/udm.ts",
            "role": "Apertura DB (openUdm: WAL, busy_timeout, synchronous NORMAL, FK OFF→migrate→FK ON) e data-access layer: tipo TrackRow, letture paginate getTracksPage (ricerca LIKE su title/artist/path + filtro needs_review) e getPlaylistTracksPage (ordine per position), logOperation su oplog, get/setSetting con upsert."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/camelot.ts",
            "role": "Normalizzatore tonalità→Camelot: accetta Camelot già pronta (8A), Open Key (4d/4m, con offset +7 corretto: 1d→8B), e notazione classica nota+alterazione+modo (inclusi ♯/♭ unicode, 'moll'/'dur' tedeschi, '-' come minore) tramite due lookup table maggiore/minore con enarmonici principali."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/harmony.ts",
            "role": "Analisi armonica pura per il Set Planner: parseCamelot, ringDistance (anello 1-12), isCompatible (regola Camelot standard: N±1 stessa lettera o N lettera opposta), compatibleKeys, bpmDeltaPct e checkTransition che produce flag tipizzati (key-clash, bpm-jump >6%, missing-key, missing-bpm) distinguendo dato mancante (null) da incompatibilità."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/health.ts",
            "role": "Pagella libreria READ-ONLY (solo COUNT SQL, zero filesystem): conteggi missing BPM/key/genre/year, needs_review, tracce senza hot cue, gruppi/tracce duplicate per acoustic_id, fingerprinted; score 0-100 come media pesata (BPM 25, key 25, genre 15, review 15, year 10, duplicati 10)."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/versionRegex.ts",
            "role": "Estrazione dell'etichetta versione (Remix, Extended Mix, Bootleg…) da titolo o filename quando manca il tag dedicato: lista keyword ordinata (frasi lunghe prima), regex BRACKETED per (…)/[…] e TRAILING per '- …' a fine stringa, strip estensione, tidy() per capitalizzazione."
          }
        ],
        "strengths": [
          "Separazione dei ruoli documentata e coerente: DDL solo Node, writer-ownership per tabella esplicitata nel commento di testa (schema.ts:3-16), core privo di dipendenze Electron → tutto testabile in isolamento.",
          "Sistema di migrazioni versionato con transazione per singola versione (schema.ts:214-221): un crash a metà lascia il DB a una versione consistente e ripartibile; v1-v3 idempotenti (IF NOT EXISTS) e la v4 gestisce correttamente il limite SQLite sui CHECK ricostruendo le tabelle con id preservati e FK OFF motivato nel commento (schema.ts:154-160, udm.ts:15-17).",
          "Configurazione concorrenza corretta per la coabitazione col sidecar Python: WAL + busy_timeout 5000 + synchronous NORMAL (udm.ts:12-14).",
          "Letture sempre paginate con total coerente alla stessa WHERE (udm.ts:54-98): la UI non riceve mai l'intera libreria; query parametrizzate ovunque, nessuna concatenazione di input utente nell'SQL.",
          "camelot.ts copre tre notazioni (classica con enarmonici e accidentali unicode, Open Key con offset verificato 1d→8B, Camelot passthrough normalizzato) e ritorna null invece di valori inventati quando non riconosce.",
          "harmony.ts è puro e onesto sui dati mancanti: keyOk/bpmDelta null + flag missing-* invece di false silenziosi; ringDistance gestisce l'adiacenza 12↔1; soglia BPM 6% esportata come costante documentata.",
          "health.ts è rigorosamente read-only e O(1) query fisse; il caso total=0 è gestito senza divisioni per zero (health.ts:31-36); pesi dello score motivati nel commento.",
          "versionRegex.ts ordina l'alternation con le frasi lunghe prima ('extended mix' prima di 'extended'), evitando catture troncate; gestisce en/em-dash e parentesi tonde/quadre."
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/udm.ts",
            "line": 25,
            "problem": "TrackRow.source è tipato 'masterdb' | 'xml', ma dalla migrazione v4 il DB accetta anche 'traktor' | 'virtualdj' | 'engine' | 'serato' (scritti realmente da foreignImport.ts:14 e dagli adapter). Il tipo mente: ogni narrowing o switch sul source a valle gestisce silenziosamente male le righe importate dai software foreign, e TypeScript non segnala nulla.",
            "fix": "Definire un tipo condiviso TrackSource = 'masterdb' | 'xml' | ForeignSource (unica source of truth importata sia da udm.ts sia da foreignImport.ts) e usarlo in TrackRow; già che si tocca l'interfaccia, aggiungere il campo created_at che SELECT * restituisce ma il tipo omette."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "line": 233,
            "problem": "getSchemaVersion fa Number(row.value) senza validazione: se meta.schema_version è corrotto o non numerico, ritorna NaN; in migrate() il for parte da NaN+1 e la condizione NaN<=4 è falsa, quindi la funzione esce senza applicare nulla e senza errore — l'app procede su uno schema di versione ignota.",
            "fix": "Validare con Number.isInteger(v) && v >= 0 && v <= SCHEMA_VERSION; in caso contrario lanciare un errore esplicito ('meta.schema_version corrotto: …') invece di degradare in silenzio."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/udm.ts",
            "line": 59,
            "problem": "La ricerca LIKE non fa escaping dei metacaratteri: un utente che cerca '100%' o 'a_b' ottiene match spuri perché % e _ vengono interpretati come wildcard (e non c'è clausola ESCAPE). Con path Windows nel campo ricercabile, anche i backslash sono frequenti nell'input.",
            "fix": "Escapare % _ e il carattere di escape nell'input (es. replace(/[\\\\%_]/g, '\\\\$&')) e aggiungere ESCAPE '\\\\' alla LIKE, sia nella COUNT sia nella SELECT."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/versionRegex.ts",
            "line": 28,
            "problem": "Le keyword generiche a parola singola ('edit', 'clean', 'dirty', 'flip', 'vip') generano falsi positivi che finiscono persistiti in tracks.version_label: '(feat. Clean Bandit)' → estrae 'Feat. Clean Bandit' come versione; 'Title - Clean Bandit Cover' → 'Clean Bandit Cover'. BRACKETED cattura l'intero contenuto della parentesi, non solo la porzione keyword.",
            "fix": "Per le keyword ambigue richiedere un contesto più forte: match solo se la keyword è l'ultima parola della parentesi/segmento (es. '\\b(?:clean|dirty|edit|flip|vip)\\s*[)\\]]?$') oppure escludere le parentesi che iniziano con feat\\.?|ft\\.?|with; tenere il match ampio solo per le frasi non ambigue ('extended mix', 'radio edit', 'remix', 'bootleg'…)."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/harmony.ts",
            "line": 84,
            "problem": "checkTransition confronta i BPM con === null: un undefined (tipico ai confini IPC/JSON dove i campi opzionali arrivano assenti anziché null) supera il guard, bpmDeltaPct(undefined, …) produce NaN, 'NaN > 6' è false → nessun flag missing-bpm né bpm-jump e bpmDelta esce NaN (che JSON serializza in null): la transizione appare sana quando il dato manca.",
            "fix": "Usare i check laschi (fromBpm == null || toBpm == null) o Number.isFinite(fromBpm) && fromBpm > 0, e allargare la firma a number | null | undefined per riflettere la realtà del confine IPC."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "line": 48,
            "problem": "UNIQUE (source, source_id) con source_id nullable: per SQLite i NULL sono tutti distinti, quindi righe con source_id NULL non collidono mai e l'upsert ON CONFLICT(source, source_id) di xmlCollection.ts:88 non scatta → ogni re-ingest di una traccia senza source_id crea un duplicato invece di aggiornare.",
            "fix": "Rendere source_id NOT NULL a livello di contratto (i writer generano sempre un id: TrackID XML, chiave sintetica dal path per i foreign) oppure aggiungere un indice UNIQUE parziale su (source, path) WHERE source_id IS NULL come rete di sicurezza."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/health.ts",
            "line": 69,
            "problem": "La componente duplicati dello score usa dup.tracks (TUTTI i membri dei gruppi duplicati): una libreria dove ogni brano ha una copia scende a 0 su quella voce anche se i file 'in eccesso' sono solo la metà — la penalità è doppia rispetto al problema reale.",
            "fix": "Penalizzare solo le copie eccedenti: ok = (total - (dup.tracks - dup.groups)) / total."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/health.ts",
            "line": 39,
            "problem": "missingKey conta solo camelot IS NULL, mentre missingGenre (riga 42) gestisce anche stringa vuota/spazi: se un writer (sidecar Python) scrivesse camelot = '' il conteggio mentirebbe. Predicati incoerenti tra metriche omologhe.",
            "fix": "Allineare: WHERE camelot IS NULL OR TRIM(camelot) = '' (idem valutare year <= 0 per missingYear)."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/camelot.ts",
            "line": 40,
            "problem": "modeStr viene lowercasato prima della classificazione: la convenzione 'M' maiuscola = maggiore / 'm' minuscola = minore (usata da alcuni tagger) viene distrutta — 'AM' (A maggiore) viene parsato come A minore (8A invece di 11B). Inoltre le forme tedesche con trattino 'C-dur'/'a-moll' danno null perché modeStr resta '-dur'/'-moll'.",
            "fix": "Valutare il caso 'M' esatto prima del toLowerCase (M → maggiore) e fare strip di un eventuale '-' iniziale dal modo prima dei confronti."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/camelot.ts",
            "line": 6,
            "problem": "Le lookup table non coprono gli enarmonici teorici Cb (=B), Fb (=E), E# (=F), B# (=C): tag rari ma validi (esportati da alcuni tool di analisi) tornano null e il brano finisce tra i missingKey.",
            "fix": "Aggiungere CB:'1B', FB:'12B', 'E#':'7B', 'B#':'8B' alla mappa maggiore e gli omologhi alla minore."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/udm.ts",
            "line": 71,
            "problem": "ORDER BY artist, title usa la collation BINARY di SQLite: case-sensitive e ASCII-only, quindi 'a-ha' ordina dopo 'Zedd' e gli artisti NULL compaiono in testa — ordinamento visibilmente sbagliato nella UI libreria.",
            "fix": "ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE, con IFNULL(artist,'~')/CASE per spingere i NULL in coda; per ordinamento accent-aware serve una collation ICU o normalizzazione in colonna dedicata."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/versionRegex.ts",
            "line": 49,
            "problem": "tidy() capitalizza con \\b\\w ogni inizio-parola inclusi i segmenti dopo apostrofi e trattini: \"don't stop edit\" → \"Don'T Stop Edit\", \"mash-up\" → \"Mash-Up\" (voluto?) ma anche \"dj's\" → \"Dj'S\".",
            "fix": "Capitalizzare solo la prima lettera di ogni token separato da spazi: label.split(' ').map(w => w[0].toUpperCase() + w.slice(1)) o regex /(^|\\s)\\w/."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/versionRegex.ts",
            "line": 58,
            "problem": "Lo strip estensione \\.[a-z0-9]{2,5}$ mangia suffissi legittimi del titolo quando la funzione riceve un titolo e non un filename: 'Track No.99' → 'Track No', 'Vol.III' → 'Vol'.",
            "fix": "Limitare alle estensioni audio note: /\\.(mp3|m4a|aac|wav|aiff?|flac|ogg|opus|wma)$/i."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/versionRegex.ts",
            "line": 36,
            "problem": "BRACKETED non accoppia le parentesi: '(Extended Mix]' matcha, e le parentesi annidate 'Title [Artist Remix (2020)]' falliscono del tutto perché la classe [^()\\[\\]] esclude la tonda interna — il label non viene estratto.",
            "fix": "Usare due regex separate per (…) e […] con backreference implicita del tipo di parentesi, e permettere un livello di annidamento o pre-strippare le parentesi interne."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/harmony.ts",
            "line": 52,
            "problem": "bpmDeltaPct guarda solo a <= 0: chiamata standalone con b = 0 ritorna 100 (delta plausibile) invece di segnalare dato invalido; oggi è protetta dall'unico call-site (checkTransition riga 84) ma è esportata e riutilizzabile senza guard.",
            "fix": "Ritornare Infinity (o NaN documentato) anche per b <= 0, o marcare la funzione come interna."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "line": 213,
            "problem": "if (!sql) continue salta le versioni senza SQL ma non scrive schema_version per quel numero: se in futuro si lascia un buco in MIGRATIONS (o l'ultima versione è vuota), meta resta indietro rispetto a SCHEMA_VERSION e le versioni successive al buco vengono ri-scandite a ogni avvio; con la v4 non idempotente (CREATE TABLE senza IF NOT EXISTS) un futuro errore di bookkeeping farebbe fallire l'open.",
            "fix": "Scrivere sempre schema_version = v anche quando la migrazione è vuota (spostare l'upsert fuori dall'if), o assert che MIGRATIONS contenga tutte le versioni 1..SCHEMA_VERSION."
          }
        ],
        "improvements": [
          "Tipo TrackSource unico condiviso tra schema/udm/foreignImport (il CHECK del DB è stato rimosso in v4 e il commento dice 'validato in codice': oggi quella validazione è implicita nei tipi dei reader — renderla esplicita con una costante runtime ALLOWED_SOURCES usata dai writer).",
          "Dopo migrazioni che ricostruiscono tabelle (stile v4), eseguire PRAGMA foreign_key_check prima di riattivare le FK in openUdm: costa poco e trasforma un'eventuale corruzione silenziosa in errore diagnosticabile.",
          "Aggiungere una suite di golden test per toCamelot ed extractVersionLabel (notazioni miste, unicode, tedesco, Open Key, casi 'feat. Clean Bandit', parentesi annidate): sono le due funzioni con più edge case linguistici e zero test visibili nel core.",
          "Ricerca libreria: oltre all'escaping LIKE, valutare FTS5 su title/artist/album per librerie grandi (LIKE '%…%' non usa indici e su decine di migliaia di tracce la ricerca degrada linearmente a ogni keystroke).",
          "checkTransition: considerare la compatibilità BPM a doppio/mezzo tempo (87↔174 è mixabile in molti generi) come flag informativo separato, e valutare i mix 'energy boost' (N+1 lettera opposta) come livello di compatibilità intermedio invece del binario ok/clash.",
          "HealthReport: esporre il breakdown per-componente dello score (ok/weight per voce) così la UI Semplice può dire 'perdi 12 punti per i BPM mancanti' senza ricalcolare; chiarire nel tipo che withoutHotCues e fingerprinted sono informativi e non pesati.",
          "Documentare (o forzare a runtime con un wrapper) la writer-ownership: oggi è solo un commento in schema.ts — un helper che rifiuta scritture Node sulle tabelle ingestion fuori dal percorso XML/foreign renderebbe il contratto verificabile.",
          "Valutare PRAGMA user_version al posto della tabella meta per il versioning: elimina il caso 'meta esiste ma riga assente/corrotta' (issue su getSchemaVersion) ed è atomico con il file."
        ]
      },
      {
        "subsystem": "Adapters DJ (crateforge/src/adapters): writer Rekordbox XML (collection/relocation/inbox/set), writer Traktor NML, writer VirtualDJ XML, reader Traktor NML / VirtualDJ XML / Engine DJ SQLite, stub Serato ed Engine writer. Hub dati = UDM SQLite (tracks/playlists/playlist_tracks/cues). STATO ATTUALE — Export: Rekordbox XML (metadati, hot cue max 8 con colore, memory cue senza colore, albero playlist con cartelle; NO loop, NO beatgrid, NO rating/color traccia); Traktor NML (metadati, TEMPO BPM, hot cue<8, loop, playlist FLAT senza cartelle; NO memory cue, NO grid anchor, NO rating); VirtualDJ XML (metadati, BPM come sec/beat, key, SOLO hot cue; NO loop, NO playlist, NO durata); Serato/Engine: solo stub {available:false}. Import: Traktor NML (metadati, BPM, key 0-23→testo, hot/memory/loop cue, albero playlist con cartelle; grid TYPE=4 scartato, RANKING/comment non letti); VirtualDJ database.xml (metadati, POI cue/loop; playlist NON importate — vivono in .vdjfolder); Engine m.db (metadati, BPM, key, playlist senza ordine affidabile; cue/loop nel blob PerformanceData NON decodificati); Serato: nessun reader; Rekordbox: import via core/xmlCollection.ts + sidecar Python (fuori da adapters). CAMPI: cue=sì (parziale, colore solo su export RB hot cue), beatgrid=solo BPM scalare (nessuna ancora, nessuna tabella UDM), playlist=sì (con lacune), rating=MAI mappato (assente anche nello schema UDM), color traccia=MAI mappato (cues.color esiste, tracks.color no).",
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/common.ts",
            "role": "Helper condivisi: iterateTracks paginato (1000/pagina), getCuesForTrack, getPlaylists/getPlaylistTrackIds, pathToLocation (path→file://localhost/...), costanti REKORDBOX_XML_LIMITS. Nessuna nozione di rating/color/beatgrid."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/xmlWriter.ts",
            "role": "SCRIVE collection XML Rekordbox: TRACK (TrackID,Name,Artist,Album,Genre,Kind fisso 'MP3 File',TotalTime,Year,AverageBpm,Tonality,Mix,Location), POSITION_MARK hot (max 8, con Red/Green/Blue da cues.color) e memory (Num=-1, senza colore), albero PLAYLISTS con cartelle. NON scrive: loop, beatgrid (elementi TEMPO), Rating, Colour, Comments, TrackNumber, DateAdded."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/relocationXml.ts",
            "role": "SCRIVE XML di relocation: stessi TrackID, Location nuova. Solo metadati base, PLAYLISTS vuoto."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/inboxXml.ts",
            "role": "SCRIVE XML 'Nuovi Acquisti': TRACK con ID fittizi 1_000_000+i + playlist 'CrateForge – Nuovi Acquisti'. Nessun cue."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/setXml.ts",
            "role": "SCRIVE XML scaletta Set Builder: COLLECTION minima + 1 playlist ordinata. Usa source_id come TrackID quando esiste."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "role": "SCRIVE NML Traktor v19: ENTRY (TITLE,ARTIST), LOCATION (DIR /:...:/, FILE, VOLUME), ALBUM, INFO (GENRE,PLAYTIME,RELEASE_DATE), TEMPO BPM, MUSICAL_KEY (testo — formato sbagliato), CUE_V2 hot (index<8) e loop (TYPE 5). Playlist solo LIST piatte con PRIMARYKEY=VOLUME+DIR+FILE. NON scrive: memory cue, grid anchor TYPE 4, cartelle, RANKING, colori."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlReader.ts",
            "role": "LEGGE collection.nml reale → ForeignLibrary: metadati, BPM, key (INFO@KEY o MUSICAL_KEY 0-23→notazione), FILESIZE kB→byte, CUE_V2→hot/memory/loop (TYPE 4 grid scartato, colore sempre null), albero playlist FOLDER/PLAYLIST con salto di $ROOT. NON legge: RANKING (rating), COMMENT, playcount, smartlist, grid anchor."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/virtualdj/vdjWriter.ts",
            "role": "SCRIVE database.xml VirtualDJ nuovo: Song@FilePath/FileSize, Tags (Author,Title,Album,Genre,Year,Remix), Scan (Bpm=60/bpm cioè sec-per-beat, Key), Poi solo hot cue (Num 1-based). NON scrive: loop, memory, playlist (.vdjfolder), Infos/SongLength, colori, rating."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/virtualdj/vdjReader.ts",
            "role": "LEGGE database.xml reale: Tags/Infos/Scan (BPM con euristica sec-per-beat vs BPM, Key, SongLength, FileSize), Poi→hot/loop (Num 1-based→0-based, colore null). Playlist NON importate (sono file .vdjfolder separati, warning esplicito). NON legge: UserColor, rating/Grouping."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/engine/engineReader.ts",
            "role": "LEGGE Engine Library m.db (SQLite read-only, introspezione difensiva colonne): Track (title,artist,album,genre,year,bpmAnalyzed|bpm,keyAnalyzed|key 0-23→notazione,length,path relativo→assoluto,fileBytes), Playlist+PlaylistEntity (piatte, isFolder sempre false). Cue/loop (blob PerformanceData) NON importati — warning. Rating/colore non letti."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/engine/index.ts",
            "role": "Stub: ENGINE_STATUS.available=false — nessun writer Engine."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/serato/index.ts",
            "role": "Stub: SERATO_STATUS.available=false — nessun reader NÉ writer Serato (unico dei 5 software senza import)."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/foreignImport.ts",
            "role": "Modello normalizzato (NormTrack/NormCue/NormPlaylist/ForeignLibrary) + importForeignLibrary: upsert idempotente per (source,source_id), rimpiazza cue e playlist della stessa source. Hub della bidirezionalità."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "role": "Schema UDM v4: tracks SENZA rating/color/comment/track_number; cues con color/label; NESSUNA tabella beatgrid. Migration 4 ha già tolto il CHECK su source per accettare traktor/virtualdj/engine/serato."
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "role": "Cablaggio: library:importForeign (traktor|virtualdj|engine → reader → importForeignLibrary), export:rekordbox/traktor/virtualdj (righe 312-322), export:targets espone SERATO_STATUS/ENGINE_STATUS (74-75)."
          }
        ],
        "strengths": [
          "Architettura hub-and-spoke corretta: ogni reader produce ForeignLibrary normalizzata e importForeignLibrary la parcheggia nell'UDM in modo idempotente (source,source_id) — aggiungere un formato non tocca gli altri.",
          "Sicurezza dati coerente: mai scrittura nei database nativi dei software (master.db, collection.nml, database.xml, m.db aperto readonly); si generano solo file nuovi da importare a mano, con limiti dichiarati in REKORDBOX_XML_LIMITS.",
          "engineReader difensivo: introspezione PRAGMA table_info + pick() di colonne alternative per sopravvivere ai cambi di schema Engine tra versioni.",
          "iterateTracks a pagine da 1000 evita di caricare l'intera libreria in memoria; progress callback ogni 500 brani in tutti i writer.",
          "Round-trip dei riferimenti playlist ben pensato: Traktor PRIMARYKEY = VOLUME+DIR+FILE identico tra writer (keyByTrackId) e reader (sourceId), VDJ usa FilePath come id stabile.",
          "Il limite 8 hot cue Rekordbox è applicato nel writer, non delegato all'import; le playlist esportate filtrano i track id realmente presenti in collection (exportedSet)."
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "line": 52,
            "problem": "MUSICAL_KEY VALUE scritto come testo ('Am', 'C#') ma Traktor si aspetta l'indice intero 0-23. Il proprio nmlReader (riga 98) fa Number(VALUE)→NaN→null: la key si perde perfino nel round-trip CrateForge→CrateForge, e Traktor reale non la leggerà.",
            "fix": "Convertire musical_key→indice 0-23 con la mappa inversa di TRAKTOR_KEY (condividerla in un modulo comune traktorKeys.ts) e scrivere anche INFO@KEY col testo per compatibilità."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/engine/engineReader.ts",
            "line": 127,
            "problem": "ORDER BY `${orderCol ? 'rowid' : 'rowid'}` è sempre rowid: il ternario è inerte. L'ordine reale delle playlist Engine è una lista concatenata via nextEntityId; con rowid si ottiene l'ordine di inserimento, sbagliato per playlist riordinate dall'utente.",
            "fix": "Se esiste nextEntityId, leggere tutte le entity della lista e ricostruire la catena (mappa id→next, partendo dall'entity non referenziata da nessun next); fallback rowid solo se la colonna manca."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/common.ts",
            "line": 92,
            "problem": "pathToLocation usa encodeURIComponent su ogni segmento: il drive letter 'C:' diventa 'C%3A' → Location='file://localhost/C%3A/Music/...'. Rekordbox esporta 'file://localhost/C:/Music/...' (colon non codificato); rischio concreto che Rekordbox non risolva i file su Windows all'import.",
            "fix": "Non codificare il primo segmento se matcha /^[A-Za-z]:$/ (o post-processare .replace('%3A', ':') sul solo drive letter). Aggiungere test di round-trip pathToLocation→locationToPath."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/xmlWriter.ts",
            "line": 39,
            "problem": "Kind hardcoded 'MP3 File' per tutti i brani: FLAC/WAV/AIFF/AAC dichiarati come MP3 nel collection XML.",
            "fix": "Derivare Kind dall'estensione del path (mp3→'MP3 File', flac→'FLAC File', wav→'WAV File', m4a→'M4A File', aiff→'AIFF File')."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "line": 55,
            "problem": "Cue persi in silenzio: memory cue mai esportate (Traktor le rappresenta come CUE_V2 TYPE 0 HOTCUE=-1) e hot cue con cue_index null scartate. Le hot cue importate da VirtualDJ senza Num (vdjReader riga 39 produce index null) spariscono nell'export Traktor.",
            "fix": "Esportare le memory come CUE_V2 TYPE 0 HOTCUE=-1; per le hot senza index assegnare il primo slot libero (come fa xmlWriter con `?? hotCues`). Restituire nel risultato il conteggio dei cue scartati."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/virtualdj/vdjWriter.ts",
            "line": 40,
            "problem": "Export VDJ scrive solo hot cue: i loop (che vdjReader sa leggere come Poi Type='loop' con Size) e le memory cue non vengono scritti — perdita asimmetrica reader/writer.",
            "fix": "Emettere Poi Type='loop' con Size=length_ms/1000 per i loop; le memory come Poi Type='cue' senza Num."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/virtualdj/vdjWriter.ts",
            "line": 27,
            "problem": "Non scrive Infos@SongLength: il proprio vdjReader legge la durata da lì (riga 70) → la durata si perde nel round-trip e VirtualDJ non la mostra finché non ri-analizza.",
            "fix": "Aggiungere song.ele('Infos', { SongLength: t.duration_s.toFixed(3) }) quando duration_s non è null."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "line": 113,
            "problem": "traktorVolume ritorna '' per path POSIX: su macOS Traktor usa il nome volume (es. 'Macintosh HD') in LOCATION@VOLUME; con VOLUME vuoto Traktor può non risolvere i file. Rilevante: il progetto è la variante MacOS.",
            "fix": "Su path POSIX derivare il volume: '/Volumes/X/...' → 'X', altrimenti nome del volume di avvio (o lasciare configurabile); documentare il limite nel risultato export."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/engine/engineReader.ts",
            "line": 17,
            "problem": "ENGINE_KEY assume ordinamento cromatico 0-11 maggiori / 12-23 minori (identico a Traktor). L'enumerazione key di Engine DJ non è verificata contro un m.db reale: se Engine usa un ordine diverso (es. circle-of-fifths interleaved), tutte le key importate sono sbagliate ma plausibili.",
            "fix": "Validare la mappa contro un Engine Library reale (brani con key nota); in assenza di conferma, marcare la key importata con warning o non importarla. NON VERIFICATO: nessun m.db di test nel repo."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "line": 83,
            "problem": "filter((p) => !p.is_folder): le cartelle playlist vengono scartate e tutte le playlist finiscono piatte sotto $ROOT — la gerarchia importata da Traktor non sopravvive al re-export verso Traktor.",
            "fix": "Ricostruire l'albero come fa xmlWriter (byParent + emit ricorsivo) emettendo NODE TYPE='FOLDER' con SUBNODES."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/xmlWriter.ts",
            "line": 69,
            "problem": "I loop non vengono esportati verso Rekordbox, ma il formato XML Rekordbox supporta POSITION_MARK Type='4' con Start/End per i loop memorizzati: il commento '§4 i loop non passano' riguarda i loop ATTIVI, non quelli salvati. Loop importati da Traktor/VDJ si perdono nel canale principale.",
            "fix": "Emettere POSITION_MARK Type='4' con End=(position_ms+length_ms)/1000 per cue_type='loop' (verificare su Rekordbox 6/7 reale prima di attivarlo)."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlReader.ts",
            "line": 46,
            "problem": "CUE_V2 TYPE 1/2/3 (fade-in, fade-out, load) non filtrati: diventano hot/memory cue fantasma nell'UDM e vengono ri-esportati verso altri software come cue utente.",
            "fix": "Trattare TYPE 1/2/3 come il TYPE 4: return null (o mapparli con un tipo dedicato se si vorrà preservarli)."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/engine/engineReader.ts",
            "line": 131,
            "problem": "isFolder sempre false e nessuna garanzia che i padri precedano i figli: importForeignLibrary (foreignImport.ts:181) ordina solo 'senza parent prima', quindi in nesting multi-livello un nipote può arrivare prima del padre → parentSourceId non risolto → playlist agganciata alla root.",
            "fix": "In engineReader ordinare le playlist topologicamente (o per profondità) prima di restituirle; in Engine 2 marcare isFolder=true per le liste che hanno figli e zero entity."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/rekordbox/xmlWriter.ts",
            "line": 57,
            "problem": "Num: String(c.cue_index ?? hotCues): il fallback usa il contatore progressivo che può collidere con un cue_index esplicito già emesso (due POSITION_MARK con lo stesso Num).",
            "fix": "Tracciare gli slot usati in un Set e assegnare al fallback il primo slot 0-7 libero."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/virtualdj/vdjReader.ts",
            "line": 26,
            "problem": "Euristica vdjBpm 'v<10 → sec-per-beat' fallisce per valori limite e non documenta il caso Tags@Bpm già in BPM interi bassi; inoltre un POI Poi senza Num diventa hot cue con index null (riga 39), tipo che poi altri writer scartano.",
            "fix": "Preferire Scan@Bpm (sempre sec-per-beat) quando presente; mappare i Poi senza Num a type 'memory' invece che 'hot' con index null."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters/traktor/nmlWriter.ts",
            "line": 92,
            "problem": "UUID: `crateforge-${p.id}` non è un UUID: Traktor genera UUID reali; valore accettato ma non conforme, e collide se si esportano due file dallo stesso DB.",
            "fix": "Usare randomUUID() da crypto, eventualmente deterministico (hash di source+id) se serve stabilità tra export."
          }
        ],
        "improvements": [
          "BIDIREZIONALE — Serato (gap più grande, unico software senza NÉ import NÉ export): implementare reader di '_Serato_/database V2' (formato binario TLV) + crates '.crate' per le playlist, e cue/loop/beatgrid dai tag GEOB 'Serato Markers2'/'Serato BeatGrid' nei file audio (base64 dentro ID3/MP4). Librerie di riferimento: seratojs, serato-tags (Python, portabile). Writer Fase 2 solo su copia con backup, come previsto da serato/index.ts.",
          "BIDIREZIONALE — Engine cue/loop: decodificare i blob PerformanceData di m.db (Engine 2.x: colonne beatData/quickCues/loops in Track, zlib con prefisso lunghezza 8 byte — formato documentato dai progetti enginelibrary/djinterop) per importare hot cue, loop e beatgrid; poi writer Engine su copia del db (djinterop/libdjinterop come riferimento di schema).",
          "BIDIREZIONALE — VirtualDJ playlist: il reader oggi importa 0 playlist. Leggere i file .vdjfolder e MyLists (XML con <song path=...>) nella cartella VirtualDJ/Folders; in export generare .vdjfolder o .m3u per playlist invece di sole tracce nel database.xml.",
          "SCHEMA UDM v5 per rating/color: aggiungere tracks.rating (0-5), tracks.color (hex), tracks.comment, tracks.track_number + tabella beatgrids(track_id, anchor_ms, bpm, beat_index). Senza queste colonne rating e colore traccia non possono MAI fluire: Rekordbox XML ha Rating/Colour, Traktor ha INFO@RANKING, VDJ ha Infos@UserColor, Engine ha rating — oggi tutti ignorati sia in lettura che in scrittura.",
          "Beatgrid reale end-to-end: nmlReader scarta i grid marker (TYPE 4, riga 45) e nessun writer li emette. Con la tabella beatgrids: import grid da Traktor CUE_V2 TYPE=4 + TEMPO, export verso Rekordbox come elementi TEMPO (Inizio/Bpm/Metro/Battito) e verso Traktor come CUE_V2 TYPE=4 — oggi 'beatgrid' è solo il BPM medio.",
          "Interfaccia adapter unificata: definire type DjAdapter = { source; read?(path): ForeignLibrary; write?(db, out, sel): ExportResult; status } e un registry, così ipc.ts:124-127 e 312-322 smettono di crescere a if-catena e ogni writer può restituire warnings strutturati (cue scartati, campi persi) da mostrare in UI come REKORDBOX_XML_LIMITS.",
          "Reader Rekordbox dentro adapters: l'import Rekordbox vive in core/xmlCollection.ts con source='xml'; spostarlo/riesporlo come adapters/rekordbox/xmlReader.ts che produce ForeignLibrary renderebbe simmetrici tutti e 5 i formati e riutilizzabile importForeignLibrary (dedup e warning inclusi).",
          "Test di round-trip automatici: per ogni coppia reader/writer (Traktor, VDJ) un test 'write→read→confronta' avrebbe già intercettato i bug MUSICAL_KEY testo/intero, SongLength mancante e C%3A nel Location. Aggiungere fixture NML/XML reali minimi in test/.",
          "Dedup cross-source nell'UDM: importando Traktor+Engine+Rekordbox lo stesso file fisico crea 2-3 righe tracks (source diverse). Aggiungere merge per path normalizzato/acoustic_id, altrimenti gli export 'tutte le tracce' duplicano i brani.",
          "Preservare i colori cue in import: NormCue.color è sempre null nei 3 reader; Traktor NML non li porta, ma VDJ (Poi@Color) e Serato Markers2 sì — leggerli quando la fonte li ha, così l'export Rekordbox (unico che già li scrive, colorAttrs xmlWriter.ts:113) smette di produrre cue senza colore."
        ]
      },
      {
        "subsystem": "crateforge/src/services — 11 servizi di dominio (backup incrementale, orfani, report Excel, relocator, auto-tagger, sync daemon, set planner, set builder, encoding, fsutil) usati dal main process Electron via src/main/ipc.ts sopra il DB UDM (better-sqlite3). Architettura coerente: master.db Rekordbox in sola lettura, scritture solo su UDM/XML, azioni distruttive gated (quarantena reversibile, setting \"scritture dirette\" verificato anche nel main).",
        "files": [
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\fsutil.ts",
            "role": "Utility FS condivise: walkFiles (async generator ricorsivo con filtro estensioni audio), hashFile SHA-256 streaming, copyWithVerify (hash src → copia → hash dest), timestampDir. Base di backup, orfani, relocator, syncDaemon."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\backup\\incrementalBackup.ts",
            "role": "Backup smart incrementale: planBackup (dry-run, confronto size+mtime stile rsync) + executeBackup (snapshot datato master.db/options.json con verifica hash, poi copia incrementale musica)."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\orphans\\orphanFinder.ts",
            "role": "Cacciatore di orfani: diff disco vs tracks.path del DB (set canonico in RAM), quarantena reversibile via rename, eliminazione definitiva opt-in gated dal setting directWrites (gate replicato in ipc.ts:281-288)."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportGenerator.ts",
            "role": "Export Excel streaming (ExcelJS WorkbookWriter): libreria o playlist, pagine SQL da 1000 righe, formattazione condizionale sui tag mancanti, riga TOTALE."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportViewer.ts",
            "role": "Lettura paginata (max 500 righe) di un .xlsx verso il renderer; cellToPlain normalizza richText/formule/date."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\relocator\\relocator.ts",
            "role": "Relocator base: findBrokenTracks (existsSync su ogni tracks.path) + matchByFilename (indice basename→path[] della nuova radice, primo candidato + lista ambigui). Output destinato a XML di re-import, mai al master.db."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\tagger\\autoTagger.ts",
            "role": "Auto-tagger year/genre: query testuali MusicBrainz (soglia score 90) o Discogs (token), RateLimiter 1.1s + backoff, produce proposte che l'utente approva; applyProposals scrive solo nell'UDM in transazione."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\watcher\\syncDaemon.ts",
            "role": "Sync daemon 'nuovi acquisti': fs.watch ricorsivo + debounce 2s + scan idempotente; nuovi file audio letti con music-metadata (TagReader iniettabile) e accodati in inbox_items; listInbox/setInboxStatus per la revisione."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\planner\\setPlanner.ts",
            "role": "Analisi read-only di playlist: checkTransition (Camelot + salto BPM >6%) su coppie consecutive, suggestBridges propone tracce-ponte compatibili con entrambe le key e BPM intermedio ±4%."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\setbuilder\\setBuilder.ts",
            "role": "Set builder greedy: da un brano seed costruisce scaletta di 2-60 brani con key Camelot compatibile, finestra BPM ±6%, curva up/flat/down, scoring (key identica, vicinanza BPM, bonus genere, malus stesso artista)."
          },
          {
            "path": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\encoding\\encoding.ts",
            "role": "Rilevamento encoding (chardet+iconv-lite) con flag confidence, riparazione mojibake UTF-8-letto-come-Latin-1, isExportSafe (controlli su caratteri di controllo e U+FFFD) per non sporcare gli export."
          }
        ],
        "strengths": [
          "Architettura di sicurezza coerente e verificata end-to-end: master.db mai scritto, quarantena reversibile preferita alla cancellazione, gate 'scritture dirette' duplicato nel main process (ipc.ts:281-288) e non solo in UI, audit trail sistematico via logOperation/oplog.",
          "Design streaming corretto per grandi librerie: walkFiles è un async generator che non accumula l'albero (fsutil.ts:17), l'export Excel usa WorkbookWriter con commit per riga (reportGenerator.ts:25,93), il piano backup manda al renderer solo riepilogo+preview di 50 voci (ipc.ts:222-230), il viewer pagina a max 500 righe.",
          "Dependency injection pensata per i test: FetchFn iniettabile nell'auto-tagger, TagReader iniettabile nel SyncDaemon; copertura test reale in tests/ (backup, orphans, syncDaemon, autoTagger, setBuilder, setPlanner, encoding).",
          "Rispetto delle policy esterne: rate limiter 1.1s + backoff esponenziale su 503/429 per MusicBrainz, soglia score >=90 conservativa, solo query testuali (niente audio/dati personali), User-Agent identificativo.",
          "Gestione robusta dei casi 'file sparito durante la scansione' (fsutil.ts:40-42), 'tag illeggibili → entra comunque marcato da revisionare' (syncDaemon.ts:150-157), 'piano backup scaduto' (ipc.ts:235), EXDEV rifiutato esplicitamente in quarantena invece di un finto move (orphanFinder.ts:99-101).",
          "copyWithVerify con verifica hash e cleanup della copia corrotta (fsutil.ts:61-71), usata sempre per gli snapshot del DB.",
          "Onestà tecnica documentata nel codice e riflessa in UI: BPM come proxy dell'energia (setPlanner.ts:13-14), daemon attivo solo ad app aperta (syncDaemon.ts:12-13), set builder dichiarato 'suggerimento matematico, non un DJ'.",
          "Le regex di encoding.ts (righe 35 e 46) sono corrette: contengono range di byte di continuazione (-¿) e caratteri di controllo (\\x00-\\x08 ecc.) verificati via hexdump — a prima vista sembrano malformate ma non lo sono."
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\orphans\\orphanFinder.ts",
            "line": 94,
            "problem": "Perdita dati silenziosa in quarantena: fs.rename SOVRASCRIVE la destinazione esistente sia su macOS (rename(2) POSIX) sia su Windows (libuv usa MOVEFILE_REPLACE_EXISTING), quindi il ramo EEXIST (riga 97) è codice morto. Due orfani con lo stesso basename in sottocartelle diverse finiscono sullo stesso path di quarantena: il secondo distrugge il primo, con log 'ok' per entrambi. Inoltre, se il loop while(n<1000) si esaurisse, il codice prosegue comunque con moved++ (riga 107) senza aver spostato nulla.",
            "fix": "Prima del rename verificare l'esistenza della destinazione (o creare il file con open 'wx'/copyFile COPYFILE_EXCL) e incrementare il suffisso finché il path è libero; lanciare errore esplicito se il loop si esaurisce invece di proseguire."
          },
          {
            "severity": "high",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\orphans\\orphanFinder.ts",
            "line": 27,
            "problem": "canon() fa normalize()+toLowerCase ma NON normalizza Unicode (NFC/NFD). Su macOS (target del progetto) APFS/HFS restituisce i nomi file in NFD mentre Rekordbox salva i path in NFC: ogni traccia con accenti/diacritici ('Beyoncé', 'Über') viene marcata FALSO ORFANO pur essendo nel DB. Combinato con la quarantena (o peggio deleteOrphans), l'utente può rimuovere file che appartengono alla libreria.",
            "fix": "canon(p) = normalize(p).normalize('NFC').toLowerCase() applicato sia ai path del DB sia a quelli del filesystem; aggiungere un test con filename NFD."
          },
          {
            "severity": "high",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\relocator\\relocator.ts",
            "line": 39,
            "problem": "findBrokenTracks esegue existsSync SINCRONO per ogni traccia (50k stat bloccanti) direttamente sul main process Electron (chiamato da ipc.ts:329 e 340): UI congelata per l'intera scansione. Caso peggiore: i path puntano a un volume di rete scollegato, dove ogni existsSync può bloccarsi per secondi → freeze di minuti/ore senza possibilità di annullare.",
            "fix": "Passare a fs.promises.stat/access con concorrenza limitata (es. 32 in parallelo) e yield periodico all'event loop; pre-controllare l'esistenza delle radici di volume per fallire in fretta sui dischi scollegati; supportare cancellazione."
          },
          {
            "severity": "high",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportViewer.ts",
            "line": 34,
            "problem": "readReportPage ricarica e ri-parsa l'INTERO workbook a ogni richiesta di pagina (wb.xlsx.readFile): con un report da 50k righe sono centinaia di MB di RAM e diversi secondi per OGNI cambio di pagina da 500 righe nel viewer (ipc.ts:306-308 lo invoca per pagina, senza cache).",
            "fix": "Cache del workbook parsato nel main (chiave path+mtime, LRU con eviction) oppure usare ExcelJS stream WorkbookReader saltando le righe fino a offset; invalidare la cache se il file cambia."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\backup\\incrementalBackup.ts",
            "line": 50,
            "problem": "Rilevamento 'modified' incompleto: copyFile non preserva il mtime, quindi il dest ha mtime = ora del backup. Il confronto destStat.mtimeMs < file.mtimeMs non rileva un file sorgente sostituito con una versione a mtime più vecchio e stessa size (restore da vecchio archivio, re-download con timestamp preservato): il backup resta silenziosamente stantio.",
            "fix": "Dopo la copia impostare il mtime del dest uguale al src con utimes, e confrontare per disuguaglianza (size !== || mtime !==) come fa rsync; in alternativa mantenere un manifest size+mtime+hash."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\fsutil.ts",
            "line": 24,
            "problem": "walkFiles inghiotte silenziosamente le directory non leggibili (catch → return): un intero sottoalbero saltato per permessi/IO error produce un backup 'completo' o una scansione orfani 'pulita' senza alcun segnale all'utente. Nota anche che le directory symlink non vengono seguite (withFileTypes: isDirectory()===false sui symlink) — sicuro contro i cicli ma non documentato.",
            "fix": "Fare accumulare a walkFiles (o a un callback onSkip) l'elenco delle directory saltate e propagarlo nei risultati di planBackup/findOrphans così la UI può mostrare 'N cartelle non lette'; documentare il comportamento sui symlink."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\fsutil.ts",
            "line": 61,
            "problem": "copyWithVerify legge la sorgente due volte (hash pre-copia + copyFile) più una lettura del dest: 3 passate complete di I/O per file. Con useHash attivo su un primo backup di 50k tracce (~500 GB) il tempo quasi triplica rispetto al necessario.",
            "fix": "Calcolare l'hash della sorgente DURANTE la copia (stream src → tee → hash + write dest), poi hashare solo il dest: 2 passate invece di 3 e stessa garanzia d'integrità."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\backup\\incrementalBackup.ts",
            "line": 100,
            "problem": "executeBackup non ha alcun meccanismo di cancellazione: il canale ipc job:cancel esiste (ipc.ts:205) ma il servizio non espone un token, quindi un primo backup di centinaia di GB non è interrompibile se non chiudendo l'app a metà copia.",
            "fix": "Aggiungere a BackupOptions un shouldCancel?: () => boolean (o AbortSignal) controllato a ogni iterazione del loop di copia, restituendo un risultato parziale con flag cancelled; collegarlo a currentCancel in ipc.ts."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportGenerator.ts",
            "line": 62,
            "problem": "Paginazione LIMIT/OFFSET con ORDER BY su colonne senza indice dedicato (idx_tracks_artist copre solo artist, niente su title): SQLite riesegue l'ordinamento dell'intero result set per ognuna delle ~50 pagine a 50k tracce (costo O(n²/PAGE)); inoltre se il DB cambia tra le pagine, righe possono essere saltate o duplicate (COUNT calcolato una volta a riga 51).",
            "fix": "Eliminare la paginazione: una sola prepare(...).iterate() sull'intera query ordinata — WorkbookWriter già streama riga per riga, la RAM resta costante e il risultato è uno snapshot consistente del singolo statement."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportGenerator.ts",
            "line": 47,
            "problem": "L'export di una playlist ignora l'ordine della playlist: WHERE t.id IN (SELECT track_id ...) + ORDER BY title/artist perde pt.position (e collassa i duplicati se una traccia compare due volte nella playlist). Per un DJ l'ordine della scaletta è spesso il dato che vuole esportare.",
            "fix": "Quando playlistId è presente e groupByArtist è falso, usare JOIN playlist_tracks pt ON pt.track_id=t.id WHERE pt.playlist_id=@pl ORDER BY pt.position."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\relocator\\relocator.ts",
            "line": 57,
            "problem": "matchByFilename confronta basename().toLowerCase() senza normalizzazione Unicode NFC: su macOS i file con accenti (NFD dal filesystem vs NFC nel DB) non matchano MAI, proprio la classe di file che più spesso ha bisogno di relocate. Stesso difetto di famiglia di orphanFinder.canon.",
            "fix": "Normalizzare entrambi i lati con .normalize('NFC') (idealmente una funzione canonicalizeName condivisa in fsutil usata da orphans/relocator/syncDaemon)."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\tagger\\autoTagger.ts",
            "line": 61,
            "problem": "La query Lucene verso MusicBrainz interpola titolo/artista dentro le virgolette senza escaping: brani con doppi apici o caratteri speciali Lucene ('12\" Mix', 'AC/DC') producono query malformate → risposta 400 → null silenzioso, contato come 'skipped' senza che l'utente capisca perché quei brani non vengono mai taggati.",
            "fix": "Escapare backslash e doppi apici nel valore (v.replace(/([\\\\\\\"])/g, '\\\\$1')) prima dell'interpolazione, o usare la sintassi di query semplice di MusicBrainz."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\tagger\\autoTagger.ts",
            "line": 104,
            "problem": "Il token Discogs viaggia come parametro nell'URL (?token=...): finisce in log di proxy/antivirus/strumenti di rete e in eventuali error report — stonato con la promessa privacy del modulo (§8). Discogs supporta l'header Authorization.",
            "fix": "Inviare il token come header 'Authorization: Discogs token=<token>' invece che in query string."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\tagger\\autoTagger.ts",
            "line": 149,
            "problem": "proposeTags seleziona sempre le stesse righe: la query (year IS NULL OR genre IS NULL) LIMIT 50 senza ORDER BY né tracking dei tentativi restituisce a ogni giro gli stessi brani; se i primi 50 non hanno match su MusicBrainz/Discogs, l'utente non supererà mai quel blocco per quante volte rilanci.",
            "fix": "Registrare i tentativi (colonna last_tag_lookup_at o tabella dedicata) ed escludere i brani tentati di recente: WHERE ... AND (last_tag_lookup_at IS NULL OR last_tag_lookup_at < datetime('now','-7 days')) ORDER BY last_tag_lookup_at."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\watcher\\syncDaemon.ts",
            "line": 115,
            "problem": "Debounce di 2s dall'ultimo evento fs.watch ma nessun controllo di stabilità del file: un WAV/AIFF grande ancora in copia (download, rete) viene letto a metà → tagReader fallisce o legge durata errata → il file entra in inbox marcato has_tag_issues pur essendo sano. fs.watch inoltre emette eventi all'inizio della copia, non alla fine.",
            "fix": "Prima di ingerire un file, verificare che size+mtime siano stabili tra due stat a distanza di ~1-2s (o riprovare i file 'with issues' al giro successivo confrontando la size registrata)."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\watcher\\syncDaemon.ts",
            "line": 158,
            "problem": "scanOnce esegue un INSERT per file ciascuno in transazione implicita (fsync per riga): la prima scansione di una cartella con migliaia di nuovi file impiega minuti solo di commit SQLite. Nota correlata: il check 'known' (riga 134-137) confronta il path per uguaglianza esatta, senza normalizzazione case/Unicode — su macOS un file già in libreria con case o forma NFD diversa viene ri-aggiunto all'inbox.",
            "fix": "Accumulare i nuovi item e inserirli in batch dentro db.transaction (chunk da ~100, fuori dagli await del tagReader); usare la stessa canonicalizzazione path condivisa proposta per orphans/relocator, oppure INSERT OR IGNORE sfruttando l'UNIQUE su inbox_items.path."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\planner\\setPlanner.ts",
            "line": 93,
            "problem": "suggestBridges filtra WHERE camelot IN (...) ma NON esiste alcun indice su tracks.camelot (schema.ts crea solo idx su path/artist/needs_review): ogni transizione problematica costa una scansione completa di 50k righe; analyzePlaylist su una playlist lunga e disordinata (decine di transizioni problematiche) impiega secondi con l'UI in attesa. Stesso costo per ogni passo di setBuilder.buildSet.",
            "fix": "CREATE INDEX idx_tracks_camelot_bpm ON tracks(camelot, bpm) nella migrazione schema: serve sia il planner sia il set builder."
          },
          {
            "severity": "medium",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\setbuilder\\setBuilder.ts",
            "line": 68,
            "problem": "candidateStmt usa LIMIT 400 SENZA ORDER BY: SQLite restituisce le prime 400 righe in ordine di rowid (cioè le tracce importate per prime). Su una libreria da 50k il pool di candidati è sistematicamente sbilanciato verso i vecchi import e i migliori match di BPM possono non essere mai considerati dallo scoring.",
            "fix": "Aggiungere ORDER BY ABS(bpm - :target) prima del LIMIT 400 (con l'indice camelot+bpm del punto precedente resta veloce), così i 400 candidati sono i più pertinenti e non i più vecchi."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\backup\\incrementalBackup.ts",
            "line": 60,
            "problem": "planBackup chiama onProgress(scanned, scanned, 'scan'): done e total sempre identici, la progress bar durante la scansione è priva di significato (sempre 100%).",
            "fix": "Passare total=0 o un flag 'indeterminate' e far mostrare alla UI un contatore ('N file esaminati') invece di una percentuale."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\orphans\\orphanFinder.ts",
            "line": 148,
            "problem": "deleteOrphans in dry-run restituisce deleted: files.length anche per file già inesistenti (che nel loop di stat sono stati saltati): il conteggio mostrato all'utente può sovrastimare.",
            "fix": "Contare solo i file per cui stat è riuscito e restituire quel numero come deleted previsto."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportGenerator.ts",
            "line": 25,
            "problem": "Nessun try/finally attorno alla scrittura: se una pagina SQL o addRow lancia, il WorkbookWriter non viene mai committato né abortito e resta su disco un .xlsx troncato/corrotto senza cleanup né messaggio chiaro.",
            "fix": "Avvolgere in try/catch: su errore chiamare workbook.commit()/abort ed eliminare il file parziale (unlink) prima di rilanciare l'errore."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\planner\\setPlanner.ts",
            "line": 97,
            "problem": "Quando from/to non hanno BPM, bpmSql è vuoto e la query include tracce con bpm NULL che ORDER BY bpm mette per prime: i 'ponti' suggeriti sono proprio le tracce non analizzate. Inoltre i ponti possono essere brani già presenti altrove nella stessa playlist (esclusi solo from/to, riga 94).",
            "fix": "Aggiungere AND bpm IS NOT NULL sempre, ed escludere tutti gli id della playlist in analisi (passandoli da analyzePlaylist a suggestBridges)."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\encoding\\encoding.ts",
            "line": 36,
            "problem": "fixDoubleEncodedUtf8 usa Buffer.from(s,'latin1') che tronca al byte basso i code point > U+00FF: una stringa che mescola Unicode reale (CJK, emoji) e marker mojibake supera il guard della regex, viene corrotta dalla conversione e può essere restituita come 'riparata' senza contenere U+FFFD.",
            "fix": "Prima della conversione, uscire con null se la stringa contiene char oltre latin1: if (!/^[\u0000-ÿ]*$/.test(s)) return null."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\watcher\\syncDaemon.ts",
            "line": 99,
            "problem": "watcher.on('error') fa solo stop() silenzioso: il daemon muore (es. cartella rinominata/unmount) e l'utente non riceve alcuna notifica; status() inoltre continua a mostrare l'ultimo folder (stop non lo azzera) e nessuno rimuove da inbox_items le righe di file nel frattempo spariti dal disco.",
            "fix": "Nel catch dell'errore loggare su oplog e notificare il renderer (callback onStopped analoga a onNewItems); azzerare folder in stop(); in listInbox o in un giro periodico marcare dismissed gli item il cui path non esiste più."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\tagger\\autoTagger.ts",
            "line": 159,
            "problem": "Il RateLimiter è istanziato dentro proposeTags: due esecuzioni concorrenti (doppio click in UI, o run MusicBrainz + Discogs in parallelo) hanno limiter indipendenti e possono superare il limite di 1 req/s imposto da MusicBrainz.",
            "fix": "Limiter a livello di modulo (uno per provider) condiviso tra tutte le chiamate, o un mutex che serializza proposeTags."
          },
          {
            "severity": "low",
            "file": "C:\\Users\\Vale\\Desktop\\Claude-Projects\\TrackList-Tool-2025-MacOS\\TrackList-Tool\\crateforge\\src\\services\\excel\\reportViewer.ts",
            "line": 16,
            "problem": "cellToPlain: le celle booleane diventano 'true'/'false' via String(v) solo per caso (typeof boolean non gestito esplicitamente) e le celle errore ({error:'#N/A'}) diventano '[object Object]'.",
            "fix": "Aggiungere i rami: typeof v === 'boolean' → v ? 'VERO' : 'FALSO' (o stringa localizzata) e 'error' in v → String(v.error)."
          }
        ],
        "improvements": [
          "Creare in fsutil una funzione unica di canonicalizzazione path/nome (normalize + NFC + lowercase con consapevolezza della piattaforma) e usarla in orphanFinder.canon, relocator.matchByFilename e nel check 'known' di syncDaemon: oggi tre confronti simili con tre semantiche diverse, ed è la radice dei bug NFC su macOS.",
          "Cablare la cancellazione (AbortSignal o shouldCancel) in tutte le operazioni lunghe — planBackup/executeBackup, findOrphans, findBrokenTracks, matchByFilename, proposeTags — e collegarla al canale job:cancel già esistente in ipc.ts:205; oggi solo alcune operazioni sono annullabili.",
          "Aggiungere la migrazione CREATE INDEX idx_tracks_camelot_bpm ON tracks(camelot, bpm): accelera suggestBridges, buildSet e qualsiasi futura query armonica; a 50k tracce trasforma scansioni complete in lookup.",
          "Relocator: usare i dati già disponibili per disambiguare i match — confrontare track.filesize (e duration_s) con i candidati invece di prendere candidates[0] arbitrario; è un miglioramento a costo quasi zero in attesa del fingerprint di Fase 2.",
          "Backup: aggiungere retention/pruning per db-snapshots (oggi crescono all'infinito, uno per esecuzione) e un report opzionale dei file presenti nel backup ma rimossi dalla sorgente, così l'utente sa che il backup non è uno specchio.",
          "copyWithVerify a passata singola (hash durante la copia con stream tee) + utimes per preservare mtime: dimezza l'I/O del backup verificato e rende corretto il confronto incrementale.",
          "Parallelizzare con concorrenza limitata (4-8) le copie piccole in executeBackup e gli stat di findBrokenTracks: su SSD/NVMe il throughput sequenziale lascia molto sul tavolo a 50k file.",
          "Colmare i buchi di test: tests/ copre bene backup/orphans/syncDaemon/tagger/planner/builder/encoding ma mancano test per relocator.ts, reportGenerator.ts, reportViewer.ts e fsutil (in particolare copyWithVerify e i casi di collisione/ENOENT di walkFiles).",
          "AutoTagger: filtrare i tag MusicBrainz folksonomici prima di proporli come genere (blacklist di tag non-genere tipo 'seen live', soglia minima di count) e validare Number(p.proposed) in applyProposals prima della UPDATE.",
          "SyncDaemon: valutare la migrazione a un watcher robusto (chokidar con awaitWriteFinish) che risolve in un colpo solo stabilità dei file in copia, eventi duplicati e differenze di piattaforma di fs.watch.",
          "Documentare (o gestire) il comportamento di walkFiles sui symlink di directory: oggi vengono silenziosamente ignorati — scelta sicura contro i cicli ma sorprendente per chi organizza la libreria con link simbolici, caso non raro tra utenti macOS con dischi esterni."
        ]
      },
      {
        "subsystem": "CrateForge Electron MAIN process (IPC registration, write gates, progress throttling, Python sidecar lifecycle) + preload contextBridge",
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts",
            "role": "Bootstrap app: crea BrowserWindow, apre UDM sqlite in userData, chiama registerIpc; windowOpenHandler -> shell.openExternal"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "role": "Registrazione di ~45 handler ipcMain.handle (library, backup, orphans, report, export, relocator, oplog, dedup, cues, tagger, stems, watcher/inbox, setbuilder, masterdb, planner, dialoghi); gate directWrites/masterDbWrites; flag ingestionRunning; runSidecarJob helper"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/sidecar.ts",
            "role": "checkSidecar (binario PyInstaller o sidecar.py in dev) e runSidecar: spawn, parsing JSON-per-riga da stdout, stderr tail 4000 char, handle {cancel, finished}"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/progress.ts",
            "role": "ThrottledProgress: coalescing eventi job:progress max 1 ogni 180ms verso webContents, finish() bypassa il throttle"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/preload/index.ts",
            "role": "contextBridge.exposeInMainWorld('crateforge', api): wrapper tipizzati per ogni canale invoke + subscribe onProgress/onNewItems con unsubscribe"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/preload/api.d.ts",
            "role": "Dichiarazione globale Window.crateforge tipata da CrateForgeApi (solo tipi)"
          }
        ],
        "strengths": [
          "Preload esemplare: contextIsolation on, nodeIntegration off, nessuna esposizione raw di ipcRenderer, canali hardcoded, wrapper tipizzati, listener con funzione di unsubscribe (preload/index.ts:92-98, 138-149)",
          "Gate delle scritture duplicati nel main e non solo in UI: orphans:delete (ipc.ts:282-289), tagger:apply target 'original' (ipc.ts:575-579), masterdb:createPlaylist (ipc.ts:718-723) verificano il setting prima di scrivere",
          "Backup obbligatorio del master.db + options.json PRIMA della scrittura diretta, con abort se il backup fallisce (ipc.ts:742-756)",
          "Pattern 'mai bulk data su IPC' rispettato: paginazione (library:page, report:view), preview limitata a 50 item nel backup plan (ipc.ts:230), dedup bounded a 500 gruppi (ipc.ts:448), piani di backup tenuti nel main via Map planId (ipc.ts:52, 221)",
          "ThrottledProgress corretto nel caso d'uso: leading-edge send, coalescing del pending, finish() che azzera il timer e garantisce l'evento finale, guardia isDestroyed (progress.ts:44-59)",
          "Sidecar: stderr tail limitato a 4000 char, fallback messaggi utente per antivirus/quarantena, finished che non rigetta mai (sempre {code}) semplificando i call-site (sidecar.ts:75-131)",
          "Audit trail sistematico via logOperation su quasi tutte le operazioni, con esiti dry-run/ok/error distinti"
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 57,
            "problem": "settings:set accetta chiavi arbitrarie dal renderer, incluse 'directWrites' e 'masterDbWrites'. I gate delle scritture (righe 283, 575, 718) leggono quegli stessi setting: un renderer compromesso puo' fare settings:set('directWrites','1') e poi orphans:delete. Il gate 'anche nel main' e' quindi auto-annullabile via IPC.",
            "fix": "Blocklist delle chiavi di gate in settings:set (throw se key in ['directWrites','masterDbWrites']) e canale dedicato es. security:enableDirectWrites che mostra dialog.showMessageBox di conferma NEL MAIN prima di scrivere il setting."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 282,
            "problem": "orphans:delete riceve files: string[] dal renderer e li passa a deleteOrphans senza verificare che siano davvero orfani rilevati da orphans:scan: con directWrites=1 e' cancellazione di path arbitrari decisi dal renderer.",
            "fix": "Applicare il pattern gia' usato per backupPlans: orphans:scan salva il risultato nel main con uno scanId, orphans:delete accetta (scanId, indici) e cancella solo path presenti nel risultato salvato."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 54,
            "problem": "win() = BrowserWindow.getAllWindows()[0] ritorna undefined se non ci sono finestre (macOS dopo chiusura finestra, app viva). Ogni handler che fa new ThrottledProgress(win().webContents) (righe 98, 119, 159, 213, 238, 257, 293, 338, 406, 550) o dialog.showOpenDialog(win(),...) (797, 801, 805) crasha con TypeError; inoltre con piu' finestre prende la prima, non quella chiamante.",
            "fix": "Usare l'evento: const w = BrowserWindow.fromWebContents(e.sender) in ogni handler (il primo parametro _e e' gia' disponibile), con fallback null-safe nel ThrottledProgress."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 436,
            "problem": "Il commento a riga 46 promette 'un solo job alla volta, serializza i writer sull'UDM', ma solo i 3 canali di ingestion controllano ingestionRunning. dedup:run, relocator:fingerprintMatch, cues:analyze, tagger:apply(original), stems:run, sidecar:downloadKey e masterdb:createPlaylist spawano sidecar che scrivono l'UDM concorrentemente a ingestion o tra loro: rischio SQLITE_BUSY / contesa writer tra processo Node (better-sqlite3) e processo Python.",
            "fix": "Introdurre un mutex/coda unica per tutti i job che toccano l'UDM (una funzione withJobLock(fn) usata da ogni handler sidecar e di ingestion), o riusare ingestionRunning in runSidecarJob."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 424,
            "problem": "Race su currentCancel: e' una singola variabile globale. Con due job sidecar sovrapposti (possibile, vedi issue precedente) il secondo sovrascrive il cancel del primo (righe 182, 424) e il .then del primo che finisce fa currentCancel = null (riga 427) cancellando il riferimento del secondo: job:cancel diventa no-op sul job attivo.",
            "fix": "Mappa jobId -> cancel (Map<string, () => void>) e job:cancel(jobId), oppure garantita la serializzazione dei job resettare currentCancel solo se e' ancora il proprio handle."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts",
            "line": 32,
            "problem": "setWindowOpenHandler chiama shell.openExternal(url) senza validare lo schema: window.open('file:///...') o schemi custom (ms-msdt:, ecc.) da un renderer compromesso diventano esecuzione/apertura arbitraria lato OS.",
            "fix": "Consentire solo http/https: const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url); aggiungere anche un handler will-navigate che blocca navigazioni fuori dall'origin dell'app."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts",
            "line": 27,
            "problem": "sandbox: false senza necessita' evidente: il preload usa solo ipcRenderer/contextBridge (nessun modulo nativo), quindi il sandbox del renderer puo' essere attivato; disattivo amplia l'impatto di una compromissione del renderer.",
            "fix": "Impostare sandbox: true e verificare il preload (compatibile: usa solo API consentite in sandbox)."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts",
            "line": 44,
            "problem": "app.whenReady().then(...) senza catch e senza try/catch attorno a openUdm: se l'UDM e' corrotto/lockato (o migrazione fallisce) si ha unhandled rejection e l'app resta senza finestra ne' messaggio. Manca anche requestSingleInstanceLock: due istanze aprono lo stesso udm.sqlite in scrittura (piu' eventuale sidecar) aumentando il rischio di lock/corruzione.",
            "fix": "try/catch con dialog.showErrorBox e app.quit su fallimento openUdm; app.requestSingleInstanceLock() con focus della finestra esistente sulla seconda istanza."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 212,
            "problem": "Molti handler async con progressi non hanno try/catch: backup:plan (212), backup:execute (234), orphans:scan (256), report:generate (292), relocator:matchAndWrite (337). Se il servizio lancia: (a) progress.finish non viene mai chiamato e un timer pendente puo' emettere un update stantio, la UI resta sullo spinner senza evento terminale; (b) il fallimento non finisce nell'oplog (incoerente con ingestXml che logga gli errori a riga 108).",
            "fix": "Wrapper comune tipo withJob(phase, handler) che crea ThrottledProgress, fa try/catch/finally, garantisce progress.finish nel finally e logOperation(...,'error') nel catch, poi rilancia."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/sidecar.ts",
            "line": 134,
            "problem": "cancel = child.kill() singolo: non uccide l'albero dei processi (fpcalc/demucs figli del sidecar restano orfani, specialmente demucs che e' pesantissimo), nessuna escalation a SIGKILL se il processo ignora SIGTERM; inoltre su POSIX il kill produce code=null che i call-site (ipc.ts:184, 428) trattano come errore generico 'exit null' invece che come annullamento.",
            "fix": "Tree-kill (taskkill /T /F su win32, process group + kill(-pid) su POSIX) con timeout ed escalation; propagare un flag cancelled nel handle e nei call-site distinguere annullato da fallito."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 600,
            "problem": "tagger:apply passa l'intero elenco proposte come argomento CLI --tags-json JSON.stringify(jobs): con centinaia di brani supera il limite di lunghezza della command line di Windows (~32K) e lo spawn fallisce in modo criptico.",
            "fix": "Scrivere il JSON in un file temporaneo nel scratch dir (o passarlo su stdin del sidecar) e passare solo il path: --tags-file <tmp>."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/sidecar.ts",
            "line": 103,
            "problem": "Il try/catch attorno a opts.onEvent(JSON.parse(line)) cattura anche le eccezioni lanciate dal callback onEvent (non solo il parse) e in quel caso richiama onEvent con un evento log: l'errore del handler viene silenziato e l'evento processato due volte. Inoltre nessuna validazione di shape sull'oggetto parsato (type/done/total non verificati).",
            "fix": "Separare: parse dentro try/catch, poi chiamare onEvent fuori dal try (o secondo try dedicato che logga); validare minimamente ev.type contro l'unione ammessa prima di inoltrare."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 363,
            "problem": "oplog:list fa Math.min(limit, 1000) ma un limit negativo passa: in SQLite LIMIT -1 = nessun limite, quindi il renderer puo' scaricare l'intero oplog aggirando il cap (stesso pattern a riga 81 per pageByPlaylist).",
            "fix": "Clamp completo: Math.max(1, Math.min(Math.floor(Number(limit) || 200), 1000)) e analogo per offset/limit di pageByPlaylist."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 525,
            "problem": "cues:save non valida l'input: positionMs puo' essere negativo/NaN, label/color di lunghezza-formato arbitrario, trackId non verificato esistente; i dati finiscono in UDM e poi nell'XML per Rekordbox.",
            "fix": "Validare: Number.isFinite(positionMs) && positionMs >= 0, label troncata (es. 100 char), color contro regex #RRGGBB o null, e verificare l'esistenza del track prima della transazione."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 234,
            "problem": "backup:execute rimuove il piano dalla Map PRIMA di eseguire (riga 237): se executeBackup fallisce a meta' l'utente deve rifare la scansione completa; inoltre i piani non eseguiti restano nella Map per sempre (leak lento se l'utente rifa' molte anteprime).",
            "fix": "Rimuovere il piano solo dopo successo (o marcarlo in-use per evitare doppia esecuzione) e dare TTL/limite alla Map (es. tenere solo l'ultimo piano)."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 683,
            "problem": "inbox:prepareXml calcola excludedForIssues = ids.length - chosen.length: conta come 'esclusi per problemi tag' anche gli id semplicemente non piu' in stato new (gia' preparati/dismissi), messaggio fuorviante in UI.",
            "fix": "Distinguere: excludedForIssues = presenti nella lista ma con has_tag_issues!==0; notFound = ids non presenti nella lista new."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts",
            "line": 55,
            "problem": "Nessuna chiusura ordinata: il db better-sqlite3 non viene mai chiuso (niente db.close su before-quit) e il SyncDaemon/eventuale sidecar in corso non vengono fermati alla quit; su WAL puo' lasciare -wal/-shm pendenti.",
            "fix": "Handler app.on('before-quit'): daemon.stop(), cancel del job sidecar corrente, db.close()."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/preload/index.ts",
            "line": 139,
            "problem": "Il tipo del payload di jobs.onProgress omette il campo message? presente in ProgressPayload (progress.ts:15): il renderer non puo' mostrare messaggi di fase tipizzati senza cast.",
            "fix": "Allineare il tipo del callback a ProgressPayload (idealmente importando un tipo condiviso da un modulo shared)."
          }
        ],
        "improvements": [
          "Validazione input centralizzata al confine IPC (es. zod o guardie manuali) in un wrapper handle(channel, schema, fn): oggi quasi tutti gli handler si fidano dei tipi TypeScript del preload, che a runtime non esistono; i punti critici sono path (xmlPath, masterDbPath, outPath, folder), array di id e opzioni backup/report tipizzate unknown nel preload (righe 29, 40, 46).",
          "Coda job unica nel main (withJobLock) per tutti i lavori che scrivono l'UDM o spawano il sidecar, con jobId ritornato al renderer e job:cancel(jobId): risolve insieme la race su currentCancel, la concorrenza Node/Python sull'UDM e rende onesta la promessa 'un solo job alla volta' del commento a ipc.ts:46.",
          "Wrapper comune per i job con progresso: crea ThrottledProgress dal sender (BrowserWindow.fromWebContents), try/catch/finally con progress.finish garantito e logOperation dell'errore, cosi' la UI riceve sempre un evento terminale e l'oplog registra anche i fallimenti.",
          "Hardening finestra: sandbox:true, whitelist http/https in setWindowOpenHandler, handler will-navigate, requestSingleInstanceLock, catch su whenReady con dialog di errore per UDM corrotto.",
          "Gate settings promossi a canali dedicati con conferma nativa (dialog nel main) e chiavi di gate rifiutate da settings:set; in prospettiva salvare i gate fuori dall'UDM scrivibile via IPC generico.",
          "Sidecar: passare payload grossi via file temporaneo o stdin invece che argv (write-tags), tree-kill con escalation per cancel, distinguere 'annullato' da 'fallito' nel risultato, validare la shape degli eventi JSON e limitare la dimensione della riga letta da stdout.",
          "Piccole pulizie: clamp completo dei limit negativi (oplog:list, pageByPlaylist), TTL sulla Map backupPlans, chiusura ordinata di db/daemon su before-quit, condividere i tipi ProgressPayload/SidecarEvent in un modulo shared tra main e preload per eliminare le duplicazioni di tipo nel preload."
        ]
      },
      {
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/App.tsx",
            "role": "Shell app: routing a stato (useState<PageId>), sidebar 18 voci, 8 expertOnly nascoste in modalità Semplice, fallback a dashboard"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/appState.tsx",
            "role": "Context globale theme/mode/locale, persistito via IPC settings"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/i18n.ts",
            "role": "Dizionario corto it/en/fr/de: nav, common, danger, SaveTarget"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/i18nPages.ts",
            "role": "1888 righe: testi lunghi per pagina x 4 lingue, complete (21 namespace per locale), pageText() con fallback it e interpolazione {param}"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/Dashboard.tsx",
            "role": "Panoramica + import XML/master.db/Traktor/VirtualDJ/Engine, stat card"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/HealthPage.tsx",
            "role": "Pagella libreria read-only con punteggio e righe problema+hint"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/BackupPage.tsx",
            "role": "Wizard backup 2 step (plan/execute); definisce ed ESPORTA PathField usato da 5 altre pagine"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/OrphansPage.tsx",
            "role": "Scan orfani -> selezione paginata -> quarantena/eliminazione con DangerConfirmDialog"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/ConverterPage.tsx",
            "role": "Matrice capacita + export 3 formati con dialog di presa visione limiti"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/RelocatorPage.tsx",
            "role": "Relocator path rotti + card FingerprintRelocator con dipendenza incrociata su newRoot"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/DedupPage.tsx",
            "role": "Dedup per impronta acustica -> quarantena"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/AutoCuePage.tsx",
            "role": "Auto-Cue assistito: sorgente ricerca/playlist, batch cancellabile, review con Waveform"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/TaggerPage.tsx",
            "role": "Auto-Tagger MusicBrainz/Discogs, apply su UDM o file originali"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/StemsPage.tsx",
            "role": "Stems Demucs single-track"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/InboxPage.tsx",
            "role": "Watcher nuovi acquisti + preparazione XML"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/PlannerPage.tsx",
            "role": "Analisi transizioni playlist (read-only)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/SetBuilderPage.tsx",
            "role": "Scaletta suggerita + export XML + scrittura opt-in master.db"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/ReviewPage.tsx",
            "role": "Tabella read-only brani da revisionare (nessuna azione)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/LogPage.tsx",
            "role": "Registro operazioni (500 righe, export txt)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/SettingsPage.tsx",
            "role": "Tema/lingua/modalita + toggle directWrites/masterDbWrites + token Discogs + stato sidecar"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/DangerConfirmDialog.tsx",
            "role": "Doppia conferma: parola da digitare + checkbox"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/SaveTargetNotice.tsx",
            "role": "Badge destinazione salvataggio (udm/copy/xml/original/masterdb)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/GuideDialog.tsx",
            "role": "Guida passo-passo export/import XML con schemi SVG"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/JobProgress.tsx",
            "role": "Barra avanzamento job IPC — etichette fasi HARDCODED in italiano"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/ExcelViewer.tsx",
            "role": "Anteprima xlsx paginata con colonne ridimensionabili — testi HARDCODED in italiano"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/Waveform.tsx",
            "role": "Waveform SVG con marker cue trascinabili (solo pointer, no tastiera)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/ui/dialog.tsx",
            "role": "Dialog Radix (focus trap ok; bottone X senza focus ring)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/ui/misc.tsx",
            "role": "Switch/Progress/Label/Checkbox/Input/Badge/Alert/Tabs (Radix + cva)"
          }
        ],
        "subsystem": "Renderer React (Electron) di CrateForge: shell con routing a stato in App.tsx, 18 pagine (8 solo-Esperto), stato globale in appState.tsx (tema/modalita/lingua via IPC), i18n a due livelli (i18n.ts corto + i18nPages.ts per-pagina, 4 lingue complete), componenti condivisi di sicurezza (DangerConfirmDialog, SaveTargetNotice, GuideDialog, JobProgressBar).",
        "strengths": [
          "Linguaggio di sicurezza coerente e raro da vedere cosi ben fatto: ogni pagina rischiosa ha Alert 'limiti dichiarati', flusso dry-run -> anteprima -> doppia conferma (parola digitata + checkbox in DangerConfirmDialog), e SaveTargetNotice che dichiara SEMPRE dove e finito un salvataggio. Gating a 3 livelli (Esperto -> directWrites -> masterDbWrites) con warning crescenti in Settings.",
          "Skeleton di pagina uniforme (h1+sottotitolo, card numerate '1 ·'/'2 ·' stile wizard, alert esito/errore in coda): l'utente impara il pattern una volta e lo ritrova ovunque.",
          "i18nPages.ts e realmente completo su 4 lingue (21 namespace ciascuna) con fallback italiano e interpolazione parametri; le lingue si cambiano live da Settings.",
          "Onboarding contestuale ben pensato: GuideDialog con schemi SVG passo-passo per le due operazioni manuali Rekordbox, ConversionMatrix che rende esplicito cosa si puo importare/esportare, card 'In arrivo' per Serato/Engine con motivazione onesta.",
          "Stati vuoti quasi ovunque con testo azionabile ('importa prima la collection dalla Panoramica'), non solo 'nessun dato'.",
          "Base a11y solida: primitive Radix (dialog con focus trap e sr-only close, label, checkbox), Enter-to-search sugli input, aside/main semantici, testo accanto ai simboli colore nella matrice conversioni.",
          "Feedback di avanzamento: JobProgressBar ascolta eventi IPC con fase+percentuale; AutoCue mostra 'brano i di N' e ha Stop; batch AutoCue aggiorna i risultati incrementalmente."
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/App.tsx",
            "line": 138,
            "problem": "Routing per smontaggio condizionale: cambiare pagina distrugge TUTTO lo stato di lavoro (risultati scan orfani, gruppi dedup, batch Auto-Cue di minuti di analisi, piano backup, scaletta Set Builder). Se l'utente va sul Registro a controllare e torna, il lavoro e perso senza avviso.",
            "fix": "Tenere le pagine montate e nasconderle con CSS (display:none) oppure spostare i risultati in store/context per pagina; in alternativa intercettare la navigazione quando esistono risultati non salvati e chiedere conferma."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/JobProgress.tsx",
            "line": 24,
            "problem": "PHASE_LABELS ('Scansione file…', 'Copia in corso…', ecc.) e toLocaleString('it-IT') hardcoded in italiano: la barra di avanzamento resta italiana per utenti EN/FR/DE nonostante l'i18n completo altrove.",
            "fix": "Spostare le etichette fase in i18nPages (namespace 'common' o 'jobs') e usare il locale corrente per la formattazione numeri."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/ExcelViewer.tsx",
            "line": 92,
            "problem": "Componente interamente hardcoded in italiano ('Impossibile leggere il file', 'Lettura del file…', 'Reimposta colonne', 'Pagina X di Y', 'it-IT'), incluso il paginatore duplicato rispetto a common.prev/next/pageOf gia esistenti.",
            "fix": "Usare pageText con un namespace 'report'/'common' e le chiavi di paginazione gia presenti nel dizionario."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/Dashboard.tsx",
            "line": 73,
            "problem": "importForeign e importMasterDb hanno try/finally SENZA catch: se l'IPC lancia (file corrotto, permessi), l'eccezione e non gestita e l'utente non vede nessun errore (solo la barra che sparisce). Inoltre le stringhe alle righe 52, 56 e 104 sono hardcoded in italiano nella pagina 'pilota' della migrazione i18n.",
            "fix": "Aggiungere catch con setMessage({kind:'error',…}) come gia fatto in importXml; spostare le 3 stringhe in i18nPages.dashboard."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/HealthPage.tsx",
            "line": 44,
            "problem": "Scoperta funzioni Esperto rotta: gli hint della pagella ('-> Auto-Tagger (Esperto)', '-> pagina Duplicati', '-> Auto-Cue') sono testo morto, non link; in modalita Semplice quelle pagine sono invisibili nella sidebar e non c'e alcuna indicazione su come attivarle. L'utente Semplice legge il rimedio ma non puo raggiungerlo.",
            "fix": "Rendere gli hint cliccabili (callback di navigazione via context/prop da App) e, in modalita Semplice, mostrare inline un CTA 'attiva la modalita Esperto nelle Impostazioni' oppure elencare le voci expertOnly nella sidebar con icona lucchetto e tooltip."
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/DedupPage.tsx",
            "line": 85,
            "problem": "Dopo la quarantena i file spostati NON vengono rimossi dalla lista gruppi (a differenza di OrphansPage.removeFromList): la UI resta stantia, l'utente puo riselezionare file gia spostati e la seconda operazione fallira. In piu il run dedup sull'intera libreria non ha bottone Stop (Auto-Cue e Stems ce l'hanno).",
            "fix": "Filtrare i path spostati dai gruppi dopo doQuarantine (riusando la logica di OrphansPage) e aggiungere un bottone annulla che chiami jobs.cancel come in StemsPage."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/AutoCuePage.tsx",
            "line": 75,
            "problem": "In modalita playlist, ogni cambio pagina ri-abilita TUTTI i brani della pagina (setEnabled con i soli row correnti), cancellando le de-selezioni manuali fatte prima; inoltre 'enabledOf' confronta enabled.size col totale libreria/playlist, non con i visibili — conteggio fuorviante. Il setTimeout(0) dopo setPlaylistId (riga 238) e un hack di race su stato.",
            "fix": "Mantenere enabled come accumulo cross-pagina (aggiungere solo gli id nuovi, senza reset), passare playlistId esplicito a loadTracks invece del setTimeout, e mostrare 'n abilitati su N selezionabili'."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/OrphansPage.tsx",
            "line": 94,
            "problem": "'Seleziona tutti' seleziona TUTTI gli orfani di tutte le pagine mentre l'utente ne vede solo 100: rischio di mettere in quarantena migliaia di file visti solo in minima parte (il conteggio c'e ma l'ambiguita resta).",
            "fix": "Sdoppiare in 'Seleziona pagina' / 'Seleziona tutti ({N})' e ripetere il totale selezionato nel testo del DangerConfirmDialog; aggiungere ordinamento per dimensione/cartella per rivedere prima i file grossi."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/RelocatorPage.tsx",
            "line": 166,
            "problem": "La card FingerprintRelocator e sempre visibile ma il suo bottone dipende da newRoot, che si imposta solo nella card 'step 2' — la quale appare solo se broken>0. Con 0 path rotti il bottone resta disabilitato per sempre senza spiegazione (dipendenza nascosta tra card). Inoltre il dry-run mostra solo conteggi: nessuna lista dei match da rivedere prima di scrivere l'XML, in contrasto con la filosofia anteprima-prima-di-confermare del resto dell'app.",
            "fix": "Dare alla card FP il proprio PathField newRoot (o mostrarla solo quando il prerequisito e soddisfatto, con nota sul perche), e mostrare un'anteprima paginata dei match/ambigui prima di 'scrivi XML'."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/SetBuilderPage.tsx",
            "line": 109,
            "problem": "Nel flusso master.db, se l'utente annulla il picker di options.json si prosegue con optionsPath null senza check (masterDbPath invece e verificato); le chiavi i18n mdbPickDb/mdbPickOptions esistono in tutte e 4 le lingue ma non sono mai usate; l'input lunghezza non e clampato (si puo digitare 0 o 999, Number('')=0).",
            "fix": "Verificare optionsPath prima di chiamare createPlaylist (o dichiararlo opzionale nella UI), usare le chiavi mdbPick* nei dialog nativi, clampare length in onChange a [2,60]."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/LogPage.tsx",
            "line": 45,
            "problem": "exportLog scrive il file e non da NESSUN feedback di esito (ne successo ne errore): l'utente non sa se l'export e avvenuto. Timestamp mostrati raw (r.ts) non formattati per locale; nessun filtro per esito/operazione su 500 righe.",
            "fix": "Mostrare un Alert di conferma con percorso (pattern gia usato ovunque), formattare ts con toLocaleString(locale), aggiungere filtro rapido per outcome."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/ConverterPage.tsx",
            "line": 133,
            "problem": "doExport chiude il dialog dei limiti PRIMA del picker di salvataggio: se l'utente annulla il salvataggio deve rifare da capo tutta la presa visione (5 limiti + checkbox). Inoltre l'export non verifica che la libreria non sia vuota.",
            "fix": "Tenere il dialog aperto finche il picker non conferma (o ricordare l'acknowledgment per formato nella sessione); disabilitare i bottoni export con tooltip se stats.tracks===0."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/TaggerPage.tsx",
            "line": 79,
            "problem": "doApplyUdm non ha try/catch ne setBusy: errore IPC non mostrato e doppio click possibile. Le proposte arrivano tutte pre-spuntate (bulk-apply facile senza revisione reale) e mancano i bottoni seleziona/deseleziona tutti presenti in OrphansPage; il limite fisso di 50 brani per query non e spiegato in UI; nessun link alle Impostazioni quando Discogs e disabilitato per token mancante.",
            "fix": "Avvolgere in try/catch con busy, aggiungere select/deselect all, spiegare il batch da 50 nel sottotitolo, rendere 'provNoToken' un link alla pagina Impostazioni."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/ReviewPage.tsx",
            "line": 62,
            "problem": "Pagina vicolo cieco: tabella read-only senza alcuna azione (aprire il file nel Finder/Explorer, mandare al Tagger, marcare come risolto, filtrare/cercare). review_reason arriva raw dal DB dentro il badge, potenzialmente tecnico e non localizzato.",
            "fix": "Aggiungere azioni per riga (mostra nel file manager, vai ad Auto-Tagger) e mappare i review_reason noti su chiavi i18n."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/BackupPage.tsx",
            "line": 28,
            "problem": "Nessuna persistenza delle cartelle scelte (musicDir/backupDir/masterDb/options): il backup e un flusso ripetuto per definizione, ma a ogni sessione l'utente rifa 4 picker. Nessuna validazione che backupDir non sia dentro musicDir. Campi readOnly: non si puo incollare un percorso.",
            "fix": "Salvare gli ultimi percorsi in settings e precompilarli; validare sovrapposizione cartelle prima del plan; opzionale consentire input manuale del path."
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/i18nPages.ts",
            "line": 364,
            "problem": "settings.expertDesc dice 'Sblocca: relocator, lettura diretta master.db, opzioni avanzate future' ma la modalita Esperto sblocca 8 pagine (relocator, dedup, auto-cue, tagger, stems, nuovi acquisti, planner, set builder): la descrizione vende molto meno di quel che c'e, danneggiando la scoperta.",
            "fix": "Aggiornare la stringa (nelle 4 lingue) elencando le 8 funzioni o rimandando a un elenco visivo."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/App.tsx",
            "line": 117,
            "problem": "Le voci di navigazione non espongono aria-current='page' (solo stile visivo) e il fallback silenzioso a dashboard quando si torna in Semplice lascia 'page' sul valore expert: riattivando Esperto si riappare sulla vecchia pagina in modo inatteso.",
            "fix": "Aggiungere aria-current={active===n.id ? 'page' : undefined} e resettare page a 'dashboard' quando il fallback scatta."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/components/ui/dialog.tsx",
            "line": 41,
            "problem": "Il bottone X di chiusura ha focus:outline-none senza focus ring sostitutivo: invisibile alla navigazione da tastiera.",
            "fix": "Aggiungere focus-visible:ring-1 focus-visible:ring-ring come sugli altri controlli."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/SettingsPage.tsx",
            "line": 159,
            "problem": "Il token Discogs viene salvato via IPC a OGNI keystroke, senza alcuna conferma visiva di salvataggio; l'utente non sa se il token e stato accettato finche non prova il Tagger.",
            "fix": "Salvare con debounce o su blur e mostrare un piccolo 'Salvato ✓'; opzionale un bottone 'verifica token'."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/HealthPage.tsx",
            "line": 38,
            "problem": "Stato di caricamento e un nudo '…'; il secondo Card ripete identici title/subtitle della testata pagina (righe 92-93); il cerchio punteggio e sempre color primary anche con score pessimo.",
            "fix": "Skeleton/spinner con testo, titolo distinto per la card dettagli (es. 'Dettaglio problemi'), colore del cerchio legato alle soglie 85/60 gia usate per scoreMsg."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/Dashboard.tsx",
            "line": 122,
            "problem": "La stat card 'Da revisionare' non e cliccabile verso la pagina Review (affordance persa); StatCard usa toLocaleString('it-IT') fisso; '—' e usato sia per 'sto caricando' sia di fatto per assenza dati.",
            "fix": "Rendere le stat card navigabili (callback verso setPage del parent), usare il locale corrente, distinguere skeleton di caricamento da valore zero."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/InboxPage.tsx",
            "line": 171,
            "problem": "I brani con has_tag_issues hanno checkbox disabilitata: impossibile includerli deliberatamente e nessun percorso per sistemarli (nessun link a Review/Tagger); il significato del simbolo di warning e implicito.",
            "fix": "Tooltip/legenda sul warning con motivo, e link 'sistemali in Da revisionare / Auto-Tagger' quando ci sono esclusi."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/PlannerPage.tsx",
            "line": 164,
            "problem": "L'indicatore 'analisi in corso' e un paragrafo in fondo alla pagina, lontano dal punto del click sulla playlist; il click avvia subito l'analisi senza affordance esplicita.",
            "fix": "Spinner/etichetta inline nella riga playlist selezionata o JobProgressBar sotto la lista."
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/pages/StemsPage.tsx",
            "line": 35,
            "problem": "La ricerca restituisce max 20 risultati senza indicare che ce ne sono altri ne paginazione; il Cancel usa jobs.cancel() globale mentre AutoCue usa un cancelRef locale — due pattern di annullamento diversi per lo stesso concetto.",
            "fix": "Mostrare 'primi 20 risultati, raffina la ricerca' e uniformare l'annullamento su jobs.cancel per tutti i job lunghi."
          }
        ],
        "improvements": [
          "Onboarding primo avvio: quando stats.tracks===0, sostituire il contenuto della Panoramica con un vero wizard a 2 scelte ('leggi master.db' se sidecar ok / 'esporta XML da Rekordbox' con GuideDialog gia aperto) invece delle stat card vuote — oggi l'utente nuovo vede tre '—' e deve intuire il primo passo.",
          "Scoperta modalita Esperto: mostrare nella sidebar in modalita Semplice le 8 voci bloccate con icona lucchetto (click -> spiegazione + link Impostazioni), oppure una card 'Strumenti avanzati' in Panoramica; oggi l'esistenza di meta app e invisibile.",
          "Estrarre componenti condivisi per la duplicazione piu evidente: (1) PathField vive in BackupPage ed e importato da Orphans/Dedup/Inbox/Relocator/Stems — spostarlo in components/; (2) blocco paginazione prev/pageOf/next copiato in OrphansPage, AutoCuePage, ReviewPage e reimplementato in italiano in ExcelViewer — farne <Pager/>; (3) coppia Alert esito/errore in coda pagina identica in 9 pagine — <OutcomeAlerts outcome error/>; (4) riga brano '{artist ?? ?} – {title ?? ?}' ripetuta in 6 pagine — <TrackLine/>.",
          "Estrarre hook condivisi: useSelectionSet (la logica setSelected(new Set(prev))+toggle e copiata in Orphans, Dedup, AutoCue, Tagger, Inbox), usePageText(page) (il wrapper tp e ridefinito identico in 17 pagine), useAsyncAction (il boilerplate busy/setError/try-catch-finally e ovunque, e le pagine che lo hanno scritto a mano male — Dashboard, Tagger — sono esattamente quelle senza catch).",
          "Persistere in settings gli ultimi percorsi usati (musica, backup, quarantena, cartella watcher) e precompilarli: sono flussi ripetitivi e oggi ogni sessione riparte da zero.",
          "Navigazione incrociata: passare una funzione navigate(page) via context per rendere cliccabili gli hint di HealthPage, la stat 'Da revisionare' della Dashboard, il suggerimento token Discogs nel Tagger e i rimandi 'importa prima dalla Panoramica' negli stati vuoti.",
          "Dedup: aggiungere selezione assistita 'tieni il migliore per gruppo' (auto-spunta i duplicati piu piccoli/peggiori lasciandone uno) e avviso se l'utente seleziona TUTTE le copie di un gruppo — oggi puo mettere in quarantena anche l'unico originale.",
          "Uniformare la formattazione locale: sostituire tutte le occorrenze di toLocaleString('it-IT') (Dashboard StatCard, JobProgress, ExcelViewer) con il locale attivo; valutare parole di conferma localizzate o quantomeno una nota che la parola e fissa (ELIMINA/SPOSTA/SCRIVI/MASTERDB restano italiane per utenti EN/FR/DE).",
          "Accessibilita: aria-current sulla nav, focus ring sul close del dialog, alternativa tastiera per lo spostamento marker in Waveform (i number input esistono gia: basta documentarlo con aria-label), rivedere i molti text-[10px]/text-xs per la leggibilita.",
          "Wizard piu leggibili: nelle pagine a step ('1 ·', '2 ·') disattivare visivamente lo step 2 finche lo step 1 non e completo (oggi appare dal nulla) e mostrare un indicatore di stato step completato, cosi il modello wizard diventa esplicito.",
          "Toast/notifiche unificate: gli esiti oggi sono Alert inline che restano a fondo pagina (a volte fuori viewport dopo un'operazione lunga); un piccolo sistema toast o auto-scroll sull'esito migliorerebbe la percezione di feedback.",
          "Ripulire i18nPages: usare o rimuovere le chiavi orfane (setbuilder.mdbPickDb/mdbPickOptions, setbuilder.errNoStart, common.warnPrefix) e aggiornare settings.expertDesc nelle 4 lingue."
        ]
      },
      {
        "subsystem": "CrateForge Python sidecar (pyrekordbox + fpcalc + mutagen). Contratto con Node (src/main/sidecar.ts): spawn `sidecar <comando> --udm-path <file>`, stdout SOLO righe JSON {type: progress|done|error|log}; dati di massa scritti direttamente nell'UDM SQLite (schema di proprietà Node, versione 4, niente DDL lato Python). Comandi: ping (smoke test, emette pong+versione Python); ingest-masterdb (apre master.db cifrato in lettura via Rekordbox6Database — key esplicita opzionale, altrimenti cache pyrekordbox — e upserta tracks/playlists/playlist_tracks con ON CONFLICT(source,source_id), commit a blocchi di 500, run tracciato in ingest_runs con status running/ok/error); fingerprint e fingerprint-batch (fpcalc -raw -json con timeout 120s, binario risolto da env CRATEFORGE_FPCALC → cartella dell'eseguibile → PATH; acoustic_id = simhash 32-bit su 4 segmenti del fingerprint grezzo, salvato in tracks.acoustic_id); match-fingerprints (relocator: fingerprinta i file in --new-root e scrive relocation_matches method='fingerprint'); analyze-cues (aubio energy/onset/tempo, max 8 cue + envelope ≤480 bucket via evento done, degrada con errore pulito senza librerie AI); stems (Demucs via subprocess); write-tags (mutagen easy=True sui file originali: hash sha256 → backup verificato → scrittura → riapertura di verifica → rollback dal backup con verifica hash in caso di errore; mappa title/artist/album/genre/year→date/bpm); masterdb-create-playlist (SCRITTURA diretta nel master.db: create_playlist + add_to_playlist + commit con USN autoinc, rollback+close su errore, ri-cifratura SQLCipher gestita da pyrekordbox; precondizione Rekordbox chiuso verificata solo a monte da Node); download-key (write_db_key_cache/download_db_key con doppio percorso di import per versioni diverse di pyrekordbox). Handshake UDM: open_udm esige file esistente e tabella tracks presente (migrazioni fatte da Node), PRAGMA busy_timeout=5000 + foreign_keys=ON. Errori: fail() emette {type:'error'} e esce con codice ≠0; Node intercetta exit code e coda stderr (ultimi 4000 char) e tratta le righe non-JSON come log. Build: PyInstaller --onedir con --collect-all pyrekordbox, fpcalc 1.5.1 scaricato e incluso nel dist (ps1 Windows, sh macOS/Linux); requirements pinnati (pyrekordbox 0.4.3, sqlcipher3-wheels 0.5.4, mutagen 1.47.0, pyinstaller 6.11.1), livello AI opzionale separato (aubio, numpy, demucs).",
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "role": "Sidecar Python: tutti i comandi (ingest-masterdb, fingerprint/-batch, match-fingerprints, analyze-cues, stems, write-tags, download-key, masterdb-create-playlist), protocollo JSON-lines, throttling progressi, normalizzazione Camelot/version-label"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/requirements.txt",
            "role": "Dipendenze base pinnate: pyrekordbox 0.4.3, sqlcipher3-wheels 0.5.4, mutagen 1.47.0, pyinstaller 6.11.1"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/requirements-ai.txt",
            "role": "Livello AI opzionale (aubio, numpy, demucs; essentia/madmom commentati per incompatibilità wheel)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/build_sidecar.ps1",
            "role": "Build Windows: venv + PyInstaller --onedir + download/bundling fpcalc.exe 1.5.1"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/build_sidecar.sh",
            "role": "Build macOS/Linux: venv + PyInstaller --onedir + fpcalc per arch (macos-arm64/x86_64, linux)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/sidecar.ts",
            "role": "Lato Node del contratto: checkSidecar (binario packaged/dev/script), runSidecar (spawn, parsing JSON-lines, righe non-JSON declassate a log, stderr tail 4000 char, cancel=kill)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/schema.ts",
            "role": "Schema UDM v4 (owner Node): tracks/playlists con UNIQUE(source,source_id), playlist_tracks PK(playlist_id,position), cues, ingest_runs, relocation_matches UNIQUE(track_id,method), inbox_items; v4 rimuove il CHECK su source per import esteri"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core/foreignImport.ts",
            "role": "Import da altri software lato Node (traktor, virtualdj, engine, serato) verso l'UDM — contesto per i comandi mancanti nel sidecar"
          }
        ],
        "strengths": [
          "Protocollo IPC pulito e difensivo: stdout solo JSON-lines, throttling obbligatorio dei progress (max ~1 evento/150ms o 100 item), dati di massa mai su stdout; Node degrada le righe non-JSON a eventi log invece di crashare",
          "Disciplina writer-ownership rispettata: nessun DDL in Python, open_udm verifica l'handshake (file esistente + tabella tracks) e usa busy_timeout 5000 + foreign_keys ON; gli upsert ON CONFLICT(source,source_id) combaciano con i vincoli UNIQUE dello schema Node v1/v4",
          "write-tags ha una catena di sicurezza completa per file: sha256 originale, backup con verifica hash, scrittura mutagen, riapertura di verifica, rollback automatico con verifica hash del ripristino, backup conservato su disco",
          "masterdb-create-playlist usa l'API supportata di pyrekordbox (create_playlist/add_to_playlist/commit con USN autoinc) con rollback+close su errore e normalizzazione del risultato di get_content (.first())",
          "Degradazione elegante delle dipendenze opzionali: import pigri con messaggi di errore azionabili (requirements-ai.txt), il sidecar base resta funzionante senza aubio/demucs",
          "Transazioni brevi con commit a blocchi (500 tracce, 25 fingerprint, 10 file scanditi) e ingest_runs traccia stato running/ok/error con errore persistito",
          "Build robusta: --onedir (meno falsi positivi AV di --onefile), --collect-all pyrekordbox, fpcalc bundled per piattaforma con fallback al PATH, versioni pinnate, gestione esplicita del falso positivo Defender lato Node",
          "acoustic_id via simhash per segmento è una buona scelta per collassare encoding diversi dello stesso audio su un ID stabile, dichiarata sperimentale"
        ],
        "issues": [
          {
            "severity": "high",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 380,
            "problem": "Perdita silenziosa di brani nelle playlist ingerite: seq = _get(song, 'TrackNo', 'Seq') or 0 collassa a 0 tutti i song privi di TrackNo/Seq (o con duplicati), e l'INSERT OR REPLACE su playlist_tracks — che ha PRIMARY KEY (playlist_id, position) — sovrascrive le righe con la stessa position: di N brani a position 0 ne sopravvive uno solo.",
            "fix": "Usare l'indice di enumerazione come fallback/tie-break: seq = _get(song, 'TrackNo', 'Seq'); position = int(seq) if seq is not None else idx, e in caso di collisione incrementare (o ordinare i songs per seq e riscrivere position = idx progressivo)."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 597,
            "problem": "analyze-cues non ha try/except attorno ad aubio.source/onset/tempo: un file corrotto o un formato non supportato solleva RuntimeError non gestito, il processo muore con traceback su stderr e nessun evento JSON error (Node ripiega sul messaggio generico exit-code).",
            "fix": "Avvolgere l'intera analisi in try/except Exception e chiamare fail(f'analisi fallita: {exc}') per mantenere il contratto JSON-lines."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 874,
            "problem": "cmd_stems lancia [sys.executable, '-m', 'demucs', ...]: in build PyInstaller frozen sys.executable è crateforge-sidecar(.exe), quindi il comando diventa 'sidecar -m demucs' che argparse rifiuta. Funziona solo in sviluppo con interprete Python reale.",
            "fix": "In modalità frozen invocare demucs in-process (demucs.separate.main([...]) o API equivalente) oppure rilevare getattr(sys,'frozen',False) e fallire con messaggio chiaro che stems richiede il sidecar in modalità script/venv AI."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 261,
            "problem": "Nel ramo except di cmd_ingest_masterdb, se anche l'UPDATE di ingest_runs o il commit falliscono (es. UDM lockato — causa plausibile dell'errore originale), l'eccezione secondaria esce non gestita: si perde l'evento JSON error e ingest_runs resta 'running' per sempre. Inoltre rb (Rekordbox6Database) non viene mai chiuso in nessun percorso.",
            "fix": "Proteggere l'aggiornamento di ingest_runs con un try/except interno e chiamare comunque fail(); aggiungere rb.close() in un finally. Valutare anche una bonifica lato Node dei run rimasti 'running' all'avvio."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 158,
            "problem": "L'handshake UDM verifica solo l'esistenza della tabella tracks, non la schema_version (tabella meta): se Node evolve lo schema (v5+ con colonne rinominate) un sidecar vecchio fallirebbe a metà ingest con errori SQL criptici invece che al bootstrap.",
            "fix": "In open_udm leggere meta.schema_version e confrontarla con un intervallo supportato (es. SUPPORTED_SCHEMA = range(4, 5)); fail() immediato con messaggio 'sidecar e app non allineati, reinstalla/rebuild'."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 924,
            "problem": "write-tags e masterdb-create-playlist ricevono i payload bulk (--tags-json, --content-ids-json) come argomento CLI: su Windows il limite della command line (~32KB) tronca/rompe lo spawn per batch grandi (centinaia di path lunghi), violando di fatto anche il principio 'dati di massa mai via IPC'.",
            "fix": "Accettare in alternativa --tags-file/--content-ids-file (path a un JSON temporaneo scritto da Node nello user data dir) e deprecare il passaggio inline oltre una soglia."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 915,
            "problem": "Argomenti dichiarati ma mai usati: --track-id di analyze-cues (le cue proposte non vengono mai persistite nella tabella cues dell'UDM, nonostante la doc di schema.ts elenchi cues tra le tabelle scritte dal sidecar) e --options-json di ingest-masterdb (riga 897).",
            "fix": "O persistere le cue accettate in cues quando --track-id è presente (coerente con la writer-ownership dichiarata), o rimuovere gli argomenti morti e aggiornare i docstring per riflettere che è Node a salvarle."
          },
          {
            "severity": "medium",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 761,
            "problem": "masterdb-create-playlist non ha alcuna difesa in profondità sulla precondizione critica 'Rekordbox chiuso' (delegata interamente a Node/UI) e non gestisce il nome playlist duplicato (crea doppioni silenziosi). La cancel() di Node (child.kill) può inoltre terminare il processo a metà commit del master.db.",
            "fix": "Aggiungere un controllo best-effort del processo Rekordbox (pyrekordbox espone get_rekordbox_pid; in alternativa tasklist/pgrep) con fail() esplicito; verificare nome esistente via db.get_playlist(Name=...) e fallire o suffissare; ignorare SIGTERM durante il commit (signal.signal) o marcare il job non-cancellabile lato Node."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 478,
            "problem": "int(args.track_id) senza try: un --track-id non numerico produce ValueError non gestito (traceback, niente JSON error).",
            "fix": "Validare con try/except e fail('--track-id non valido'), o type=int direttamente in argparse."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 553,
            "problem": "match-fingerprints: se più file candidati hanno lo stesso acoustic_id (duplicati reali nella nuova cartella), INSERT OR REPLACE su UNIQUE(track_id, method) fa vincere silenziosamente l'ultimo scandito; l'ambiguità non è segnalata né all'UDM né alla UI.",
            "fix": "Tenere il primo match e contare i conflitti (campo ambiguous/matches_count o evento log con il numero di collisioni), lasciando a Node la scelta di marcare needs_review."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 751,
            "problem": "write-tags tronca results a 100 voci nell'evento done: per batch grandi Node perde l'esito (ok/rolledBack/error) dei file oltre il centesimo.",
            "fix": "Scrivere l'esito completo per-file nell'UDM (es. oplog) o in un file JSON accanto al backup_dir, mantenendo su stdout solo il riassunto."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 340,
            "problem": "Le smartlist di Rekordbox (Attribute==4) vengono ingerite come playlist normali con is_folder=0 e membership vuota (Songs non popolato): in UI appaiono come playlist vuote indistinguibili.",
            "fix": "Distinguere attr==4 (saltarle, o aggiungere una colonna/flag is_smart lato Node) invece di ingerirle vuote."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 295,
            "problem": "Euristica BPM 'raw>400 → /100' fragile per costruzione: un BPM Rekordbox memorizzato x100 ma ≤400 (brani ≤4 BPM, caso limite) resterebbe non diviso; viceversa un ipotetico BPM già in unità reali >400 verrebbe diviso.",
            "fix": "Con pyrekordbox il campo DjmdContent.BPM è sempre x100: dividere incondizionatamente per 100 quando la sorgente è masterdb, eliminando l'euristica."
          },
          {
            "severity": "low",
            "file": "TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "line": 456,
            "problem": "acoustic_id_from_raw ignora il resto della divisione (n % segments valori finali del fingerprint non votano in nessun segmento) e per fp molto corti il fallback fp[-seg_len:] fa votare due volte gli stessi dati.",
            "fix": "Distribuire il resto sull'ultimo segmento (chunk = fp[s*seg_len : n if s==segments-1 else (s+1)*seg_len]); irrilevante per la stabilità ma rende l'ID funzione di tutto il fingerprint."
          }
        ],
        "improvements": [
          "Ingestione delle cue dal master.db: il comando ingest-masterdb non legge djmdCue (hot cue, memory cue, loop) benché la tabella UDM cues esista e la doc dichiari il sidecar come suo scrittore — per un tool DJ è il dato più prezioso dopo i metadati. Aggiungere la lettura via rb.get_cue()/relazione Content→Cues con cue_type/cue_index/position_ms/length_ms/color/label.",
          "Comando read-tags/scan-folder (mutagen è già bundled): leggere metadati ID3/Vorbis/MP4 direttamente dai file audio di una cartella e popolare inbox_items/tracks — abiliterebbe la coda Nuovi Acquisti e l'import di librerie senza database. Oggi nessun comando del sidecar legge tag, solo scriverli.",
          "Import da altri software nel sidecar: Node gestisce traktor/virtualdj/engine/serato via XML/CSV (foreignImport.ts), ma (a) Serato: le crate .crate e le cue nei GEOB 'Serato Markers2' sono binarie — decodificarle in Python con mutagen è molto più semplice che in Node → comando ingest-serato con cue; (b) Engine DJ: m.db/hm.db sono SQLite in chiaro — il sidecar ha già sqlite3 → comando ingest-enginedj con beatgrid/cue dai blob; (c) Traktor NML: le cue (CUE_V2) potrebbero essere ingerite nella tabella cues.",
          "Difesa in profondità su masterdb-create-playlist: verifica del processo Rekordbox in esecuzione prima dell'apertura in scrittura, e backup del master.db verificato per hash anche lato sidecar (oggi la precondizione vive solo in Node).",
          "Estendere _content_to_track ai campi Rekordbox utili già disponibili: Rating, ColorID, Commnt (commento), DJPlayCount, created_at/StockDate (data aggiunta), Remixer, Label — oggi persi nell'ingest.",
          "Handshake versione: aggiungere al done di ping anche la versione del sidecar e di pyrekordbox (oltre a python), così Node può rifiutare abbinamenti incompatibili e la diagnostica in-app migliora.",
          "Prestazioni fingerprint: fpcalc supporta -length per limitare i secondi analizzati (default 120) — ridurlo a ~60 raddoppia il throughput del batch senza degradare il simhash; valutare anche un pool di 2-4 processi fpcalc paralleli con commit UDM serializzati.",
          "match-fingerprints: pre-filtrare i candidati per estensione+dimensione/durata simile prima di fingerprintarli tutti (oggi O(n) fpcalc su ogni file della nuova root), e supportare più root di ricerca.",
          "Robustezza cancel: Node cancel() fa child.kill() secco; per write-tags e masterdb-create-playlist introdurre uno shutdown cooperativo (gestire SIGTERM completando il file/commit corrente) per evitare file a metà scrittura.",
          "download-key: verificare contro pyrekordbox 0.4.3 pinnato quale dei due percorsi di import è quello reale e loggare (type:log) quale è stato usato; oggi il doppio try/except maschera anche errori di packaging PyInstaller (modulo non raccolto) presentandoli come 'versione non supportata'."
        ]
      },
      {
        "subsystem": "CrateForge — suite di test (Vitest via Electron-as-Node) e pipeline di build/packaging (electron-vite + electron-builder + GitHub Actions + sidecar PyInstaller)",
        "files": [
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/package.json",
            "role": "Script npm (test/build/dist/typecheck/rebuild), dipendenze pinnate esatte, postinstall install-app-deps per ABI Electron"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/scripts/run-vitest.cjs",
            "role": "Runner che esegue Vitest dentro il Node di Electron (ELECTRON_RUN_AS_NODE) per far combaciare l'ABI di better-sqlite3"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/vitest.config.ts",
            "role": "Config Vitest: include tests/**/*.test.ts, env node, timeout 20s, alias @core/@services/@adapters"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/electron.vite.config.ts",
            "role": "Build main/preload/renderer; externalizeDepsPlugin per main e preload; alias duplicati rispetto a vitest/tsconfig"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/electron-builder.yml",
            "role": "Packaging: dmg+zip (mac, unsigned identity null), nsis+portable (win), extraResources sidecar onedir + assets, asarUnpack .node"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tsconfig.json",
            "role": "Root con project references verso node e web"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tsconfig.node.json",
            "role": "Typecheck strict di main/preload/core/services/adapters/tests + electron.vite.config.ts (ma NON vitest.config.ts)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tsconfig.web.json",
            "role": "Typecheck strict renderer React"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/.github/workflows/build.yml",
            "role": "CI: matrice macos-latest+windows-latest, build sidecar Python, npm test, build, package unsigned, upload artifact"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/udm.test.ts",
            "role": "Test schema/migrazioni idempotenti, settings, oplog, paginazione tracce"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/xmlCollection.test.ts",
            "role": "Test ingest collection.xml Rekordbox: tracce/playlist/cue, camelot, version label, encoding sospetto, idempotenza"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/xmlWriters.test.ts",
            "role": "Test writer Rekordbox XML (limite 8 hot cue), Traktor NML, VirtualDJ XML"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/foreignImport.test.ts",
            "role": "Test reader Traktor NML e VirtualDJ (path, bpm, cue, playlist) + import UDM idempotente + schema v4"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/engineImport.test.ts",
            "role": "Test reader Engine Library SQLite (key 0-23, playlist) + rifiuto db invalido"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/camelot.test.ts",
            "role": "Test conversione notazioni key → Camelot (classica, Open Key, unicode, invalidi)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/harmony.test.ts",
            "role": "Test regola Camelot, wrap 12→1, checkTransition (key-clash/bpm-jump/missing), bpmDeltaPct"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/versionRegex.test.ts",
            "role": "Test estrazione version label (parentesi, trattino, bootleg/mashup, estensioni, falsi positivi)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/encoding.test.ts",
            "role": "Test decodeBuffer (UTF-8, Shift-JIS), riparazione mojibake, isExportSafe/hasSuspectEncoding"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/health.test.ts",
            "role": "Test computeHealth: score 0/100, buchi metadati, duplicati acustici, senza-cue"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/backup.test.ts",
            "role": "Test backup incrementale: piano dry-run puro, copia solo modificati (mtime+size), snapshot DB pre-copia, verifica hash"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/orphans.test.ts",
            "role": "Test orfani: diff disco/DB case-insensitive, quarantena dry-run/reale, delete diretto con oplog"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/setBuilder.test.ts",
            "role": "Test catena armonica: transizioni compatibili, no ripetizioni, exhausted, errore su start senza key/BPM"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/setPlanner.test.ts",
            "role": "Test analisi playlist (clash+bpm-jump) e suggerimento ponti compatibili con entrambi i lati"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/autoTagger.test.ts",
            "role": "Test MusicBrainz/Discogs con fetch mockato (score, retry 503/429, offline), proposeTags dry-run + applyProposals"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/syncDaemon.test.ts",
            "role": "Test inbox watcher: scan idempotente, tag corrotti, skip file in libreria, XML Nuovi Acquisti, stati"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/sidecar.e2e.test.ts",
            "role": "E2E contratto Node↔sidecar Python (JSON-per-riga, handshake, degrado pulito); skipIf senza venv"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/writeTags.e2e.test.ts",
            "role": "E2E write-tags: backup hash-identico pre-scrittura, rollback verificato su non-audio, file mancante pulito"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/fixtures/collection.xml",
            "role": "Fixture collection Rekordbox (4 tracce, playlist, 12 cue)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/fixtures/make_audio_fixture.py",
            "role": "Generatore MP3 reale per e2e write-tags (mai byte fabbricati in Node)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "role": "Sidecar Python 962 righe, 9 comandi CLI — coperto solo parzialmente dagli e2e"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/build_sidecar.ps1",
            "role": "Build PyInstaller onedir Windows + download fpcalc (fallimento = solo warning)"
          },
          {
            "path": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "role": "808 righe di handler IPC con logica di dominio inline (es. dedup:run) — non testato"
          }
        ],
        "strengths": [
          "Suite behavior-driven di 18 file (~1520 righe) che testa i CONTRATTI DI SICUREZZA dell'app, non i dettagli: dry-run che non scrive mai (backup, orfani, proposeTags), rollback verificato byte-per-byte con sha256 (writeTags), quarantena che sposta e mai elimina, idempotenza di ogni import (xml, traktor, engine, inbox)",
          "Soluzione ABI elegante e ben documentata: run-vitest.cjs esegue Vitest col binario Electron in modalità ELECTRON_RUN_AS_NODE, così better-sqlite3 compilato da postinstall per l'ABI di Electron carica nei test senza doppie ricompilazioni",
          "Test deterministici e isolati: SQLite :memory: con migrate(), mkdtempSync+rmSync per ogni test FS, FetchFn iniettabile con mock a sequenza per retry 503/429/offline, RateLimiter iniettato per non dormire nei test",
          "E2E realistici del confine Node↔Python: fixture MP3 generata da Python vero (mutagen la riconosce), skipIf(!hasVenv) pulito in locale, e in CI il sidecar viene costruito PRIMA di npm test quindi gli e2e girano davvero",
          "Config coerente e strict: alias @core/@services/@adapters allineati tra electron.vite.config.ts, vitest.config.ts e tsconfig paths; TS strict con project references node/web; dipendenze pinnate esatte (niente ^) per build riproducibili",
          "Scelte di packaging motivate nei commenti: PyInstaller --onedir contro i falsi positivi antivirus, asarUnpack per i .node, identity:null e CSC_IDENTITY_AUTO_DISCOVERY=false espliciti con rimando al README per il warning Gatekeeper/SmartScreen",
          "CI con matrice mac+win, fail-fast:false, cache npm configurata correttamente con cache-dependency-path, ordine giusto (deps → sidecar → test → build → package)"
        ],
        "issues": [
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/services/relocator/relocator.ts",
            "problem": "Il relocator (findBroken/matchAndWrite) e l'adapter relocationXml.ts sono completamente privi di test: è la feature che riscrive i path della libreria dell'utente, l'area a più alto rischio di danno dati insieme a orfani e write-tags (che invece sono testati)",
            "fix": "Aggiungere tests/relocator.test.ts: DB seminato con path rotti + albero temp con file ricollocati, verificare match per filename/size, generazione XML di relocation e che nulla venga scritto in dry-run"
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/.github/workflows/build.yml",
            "line": 4,
            "problem": "Il workflow gira solo su push a main e workflow_dispatch: nessun trigger pull_request e nessuno step typecheck, quindi errori TS e test rotti arrivano su main senza alcun gate (lo script typecheck esiste in package.json ma la CI non lo esegue mai)",
            "fix": "Aggiungere 'pull_request:' ai trigger, uno step 'npm run typecheck' prima dei test, e un blocco concurrency con cancel-in-progress per i push ravvicinati"
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/sidecar.py",
            "problem": "962 righe e 9 comandi CLI, ma solo 3 hanno copertura (ping, ingest-masterdb solo percorso d'errore, write-tags): fingerprint, fingerprint-batch, match-fingerprints, analyze-cues, stems, download-key e masterdb-create-playlist non hanno alcun test, né e2e né pytest",
            "fix": "Introdurre pytest nel sidecar (le funzioni cmd_* sono già separabili) con fixture audio generate da make_audio_fixture.py; in alternativa estendere gli e2e Node almeno ad analyze-cues e masterdb-create-playlist che non richiedono rete"
          },
          {
            "severity": "high",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/build_sidecar.ps1",
            "line": 36,
            "problem": "Se il download di fpcalc fallisce il build emette solo Write-Warning e prosegue: la CI impacchetta e pubblica silenziosamente un artefatto senza fpcalc.exe, degradando dedup e relocator per fingerprint senza che nessuno se ne accorga; inoltre il binario è scaricato da GitHub a ogni run senza verifica hash",
            "fix": "In CI aggiungere uno step di verifica post-sidecar (test -f dist/crateforge-sidecar/fpcalc.exe e dell'eseguibile sidecar) che fallisca il job; pinnare il download con checksum SHA256 o committare/cachare il binario"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/.github/workflows/build.yml",
            "line": 13,
            "problem": "macos-latest è arm64: dmg/zip e sidecar PyInstaller risultano solo Apple Silicon; gli utenti Mac Intel ricevono un'app che non parte, e il workflow non lo dichiara da nessuna parte",
            "fix": "Estendere la matrice con macos-13 (x64) oltre a macos-latest (arm64) e nominare gli artifact per arch; il target universal è sconsigliato qui perché richiederebbe lipo sia di better-sqlite3 sia del sidecar PyInstaller"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/ipc.ts",
            "line": 436,
            "problem": "Logica di dominio inline negli handler IPC (es. dedup:run con query dei gruppi duplicati e cap 500, relocator:fingerprintMatch): 808 righe non testabili senza avviare Electron, mentre tutto il resto del dominio vive in servizi testati",
            "fix": "Estrarre la query dei gruppi duplicati e le trasformazioni in src/services/dedup/ e testarle con :memory: come gli altri servizi; lasciare in ipc.ts solo orchestrazione sidecar+progress"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/services/excel/reportGenerator.ts",
            "problem": "reportGenerator.ts e reportViewer.ts (exceljs) non hanno test: il report Excel è un deliverable visibile all'utente e il viewer fa parsing di file arbitrari",
            "fix": "Test round-trip: generare il report da un DB seminato, rileggerlo con reportViewer e verificare colonne/righe/paginazione; coprire anche setXml.ts (export set Rekordbox) nello stesso giro"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/i18nPages.ts",
            "problem": "1888 righe di dizionari per 4 lingue (it/en/fr/de) senza alcun test di parità: una chiave dimenticata in una lingua produce testo mancante silenzioso a runtime (il file è dichiarato 'debito i18n tracciato')",
            "fix": "Test da 20 righe: per ogni pagina, l'insieme delle chiavi di en/fr/de deve essere uguale a quello di it (Object.keys diff), eseguibile in Vitest importando il modulo puro"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/vitest.config.ts",
            "problem": "Nessuna coverage configurata (@vitest/coverage-v8 assente dalle devDependencies): impossibile sapere quanto dei ~778 LOC di servizi non testati sfugga, e la CI non ha alcuna soglia",
            "fix": "Aggiungere @vitest/coverage-v8, blocco coverage con include src/core+src/services+src/adapters e una soglia iniziale realistica (es. lines 70%) da alzare nel tempo"
          },
          {
            "severity": "medium",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/.github/workflows/build.yml",
            "line": 27,
            "problem": "Nessuna cache per pip (setup-python supporta cache: pip), né per i download di Electron/electron-builder: ogni run riscarica PyInstaller, wheel, Electron e fpcalc — build lente e flaky su errori di rete",
            "fix": "setup-python con cache: 'pip' e cache-dependency-path: crateforge/python-sidecar/requirements.txt; actions/cache su ~/.cache/electron e ~/.cache/electron-builder (e AppData\\Local\\electron\\Cache su Windows)"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/sidecar.e2e.test.ts",
            "line": 53,
            "problem": "Il terzo test ha due debolezze: se la fixture master.db manca fa 'return' e passa in verde senza verificare nulla, e l'asserzione accetta sia esito error sia done (non fallirebbe mai qualunque cosa accada)",
            "fix": "Usare it.skipIf(!existsSync(fixture)) così lo skip è visibile nel report, e fissare l'esito atteso della fixture (è deterministica: o è sempre error o sempre done) invece del ramo doppio"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tsconfig.node.json",
            "line": 28,
            "problem": "electron.vite.config.ts è incluso nel typecheck ma vitest.config.ts no: la config dei test non è mai typecheckata",
            "fix": "Aggiungere \"vitest.config.ts\" all'array include di tsconfig.node.json"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/package.json",
            "line": 14,
            "problem": "'npm run dist' non garantisce che python-sidecar/dist/crateforge-sidecar esista: electron-builder fallisce a metà (o peggio, impacchetta un sidecar stantio di una build precedente) se si dimentica build_sidecar",
            "fix": "Aggiungere uno script predist che verifichi l'esistenza e la freschezza di python-sidecar/dist/crateforge-sidecar con messaggio d'errore chiaro"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/.github/workflows/build.yml",
            "line": 54,
            "problem": "Artifact senza retention-days (default 90 giorni di storage), nessun timeout-minutes sul job, e nessun release job: la pubblicazione di una versione richiede download manuale degli artifact",
            "fix": "retention-days: 14 sugli artifact, timeout-minutes: 45 sul job, e un job release condizionato a tag v* che carichi gli artifact con gh release"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/preload/index.ts",
            "problem": "Nessun test di contratto tra i canali invocati dal preload (155 righe) e gli handler registrati in ipc.ts: un typo nel nome canale si scopre solo a runtime nell'app",
            "fix": "Test statico che estrae le stringhe ipcMain.handle('...') da ipc.ts e ipcRenderer.invoke('...') dal preload (regex sui sorgenti) e verifica che ogni canale invocato abbia un handler"
          },
          {
            "severity": "low",
            "file": "C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tsconfig.node.tsbuildinfo",
            "problem": "tsconfig.node.tsbuildinfo e tsconfig.web.tsbuildinfo presenti nella root del progetto: artefatti incrementali che non dovrebbero finire nel VCS",
            "fix": "Aggiungere *.tsbuildinfo al .gitignore (o impostare tsBuildInfoFile verso una dir di cache)"
          }
        ],
        "improvements": [
          "Priorità 1 — test relocator: è l'unico servizio che riscrive path di libreria senza alcuna rete di sicurezza automatica; stesso pattern dei test orphans (mkdtemp + :memory:), costo stimato basso perché relocator.ts è solo 73 righe",
          "Priorità 2 — CI come gate: trigger pull_request + step typecheck + concurrency; oggi la matrice mac/win serve solo da packaging, non da guardia di qualità",
          "Priorità 3 — verifica integrità artefatto in CI: step che controlli la presenza di crateforge-sidecar(.exe) e fpcalc(.exe) in python-sidecar/dist prima di electron-builder, così il fallback 'solo warning' del build script non produce release mute senza fingerprinting",
          "Aggiungere pytest al sidecar Python (962 righe sono il singolo file meno coperto del progetto) partendo da analyze-cues e masterdb-create-playlist che sono puri e deterministici; download-key testabile mockando la rete",
          "Estrarre la logica di dominio da ipc.ts (dedup, composizione relocator+fingerprint) in servizi testabili: il file a 808 righe è il punto dove il pattern 'core testato / IPC sottile' si sta erodendo",
          "Test di parità chiavi i18n (4 lingue, 1888 righe): rapporto costo/beneficio migliore dell'intera lista, ~20 righe di test",
          "Coverage v8 con soglia in CI per rendere visibili i buchi futuri (excel/, relocator/, fsutil.ts oggi invisibili)",
          "Matrice macOS x64+arm64 (macos-13 + macos-latest) con artifact nominati per arch, finché non si valuta una build universal",
          "Cache pip/Electron/electron-builder in CI e fpcalc pinnato con checksum: build più veloci, meno flakiness, supply chain verificata",
          "In prospettiva release: job su tag v*, artifactName espliciti in electron-builder.yml (es. CrateForge-${version}-${os}-${arch}.${ext}), retention-days sugli artifact e — quando ci sarà un certificato — firma e notarizzazione al posto di identity: null",
          "Unificare gli alias definiti tre volte (electron.vite.config.ts, vitest.config.ts, tsconfig.node.json paths): un helper condiviso o vite-tsconfig-paths elimina il rischio di drift silenzioso"
        ]
      }
    ],
    "research": [
      {
        "app": "Rekordbox (Pioneer DJ / AlphaTheta), famiglia rekordbox 5/6/7. Due formati rilevanti: (1) export/import XML \"DJ_PLAYLISTS\" (rekordbox.xml), formato di interscambio pubblico e documentato ufficialmente da Pioneer; (2) database collection interno master.db, introdotto con rekordbox 6 e usato anche da rekordbox 7. Tutti i fatti sotto sono verificati sulla spec ufficiale Pioneer + docs pyrekordbox + manuale Lexicon; dove non confermato lo segnalo.",
        "formatType": "DUE FORMATI DISTINTI. (A) rekordbox.xml = XML UTF-8, root <DJ_PLAYLISTS Version=\"1.0.0\"> con figli <PRODUCT> (Name/Version/Company), <COLLECTION Entries=\"n\"> (lista di <TRACK>) e <PLAYLISTS> (albero di <NODE>). Formato pubblico per condivisione playlist tra app. Stringhe UTF-8 con entita XML escape (& < > ' \"); numerici locale-independent (decimale punto o virgola, niente spazi tra cifre). (B) master.db = SQLite3 cifrato con SQLCipher4 (rekordbox 6/7). La chiave SQLCipher e la stessa per tutti i DB (non dipende da macchina/licenza), quindi risiede localmente; nelle versioni recenti di rekordbox 6 Pioneer ha offuscato la chiave dentro l'app, quindi va estratta/scaricata (pyrekordbox espone il comando \"download-key\" che la mette in cache). NON verificato il numero di versione esatto in cui e cambiata; il meccanismo download-key e reale. Prima di rekordbox 6 il DB era DeviceSQL .edb, formato diverso.",
        "location": "rekordbox.xml: file esportato manualmente dall'utente (Preferences > Advanced > Database > \"rekordbox xml\"), path scelto dall'utente, nessuna posizione fissa. master.db (rekordbox 6/7): su macOS in ~/Library/Pioneer/rekordbox/master.db (il progetto e MacOS); su Windows in %APPDATA%/Pioneer/rekordbox/master.db. Accanto al DB ci sono i file di analisi ANLZ per traccia (ANLZ0000.DAT / .EXT / .2EX) in share/PIONEER/USBANLZ; il path del file ANLZ per traccia e nella colonna DjmdContent.AnalysisDataPath. Beatgrid ad alta risoluzione, cue e waveform vivono nei file ANLZ, NON in tabelle del master.db.",
        "readable": "XML: leggibile da chiunque (testo). pyrekordbox.RekordboxXml legge/scrive; disponibili anche parser XML generici. master.db: leggibile solo con chiave SQLCipher. pyrekordbox (classe Rekordbox6Database / MasterDatabase) apre e legge il DB decifrandolo automaticamente (installa sqlcipher via pacchetto sqlcipher3-wheels e recupera la chiave con download-key). File ANLZ: binari con tag a 4 lettere; leggibili con pyrekordbox (modulo anlz) o con la libreria Java crate-digger di Deep Symmetry.",
        "writable": "XML: scrivibile liberamente (RekordboxXml.add_track / add_playlist, oppure generazione manuale). L'import in rekordbox e non distruttivo: le tracce XML appaiono sotto il nodo \"rekordbox xml\" del browser e vanno importate nella collection; l'import AGGIUNGE/AGGIORNA ma non rimuove tracce (le tracce cancellate a monte non spariscono da rekordbox). master.db: scrivibile via pyrekordbox (commit()), MA rischioso: scrivere mentre rekordbox e in esecuzione puo corrompere lo stato / creare conflitti di sync cloud (USN, colonne rb_local_usn/updated_at). Raccomandato: chiudere rekordbox e fare backup prima di scrivere. NON esiste API ufficiale di scrittura sul DB; e reverse engineering.",
        "fields": [
          "TRACK (XML) attributi VERIFICATI da spec ufficiale: TrackID (sint32, id), Name, Artist, Composer, Album, Grouping, Genre, Kind (tipo file audio), Size (Octet/byte), TotalTime (secondi SENZA decimali), DiscNumber, TrackNumber, Year, AverageBpm (float64 con decimali), DateModified (yyyy-mm-dd), DateAdded (yyyy-mm-dd), BitRate (Kbps), SampleRate (Hertz float64), Comments, PlayCount, LastPlayed (yyyy-mm-dd), Rating, Location, Remixer, Tonality, Label, Mix, Colour",
          "Rating (XML) mapping ESATTO e VERIFICATO: 0 stelle=\"0\", 1=\"51\", 2=\"102\", 3=\"153\", 4=\"204\", 5=\"255\" (passo 51)",
          "Tonality (XML) = stringa della tonalita musicale (es. 'Am', 'F', o notazione mostrata). Nel DB: DjmdContent.KeyID -> DjmdKey.ScaleName (+ Seq)",
          "Colour (XML) = colore di raggruppamento traccia, formato RGB 3 byte. 8 colori nominati VERIFICATI: Rose 0xFF007F, Red 0xFF0000, Orange 0xFFA500, Lemon 0xFFFF00, Green 0x00FF00, Turquoise 0x25FDE9, Blue 0x0000FF, Violet 0x660099. Nel DB: DjmdContent.ColorID -> DjmdColor (ColorCode, Commnt=nome)",
          "Location (XML) = URI file, atteso 'file://localhost/...', include il nome file; campo ESSENZIALE per ogni traccia",
          "master.db DjmdContent (tracce) colonne principali: ID, FolderPath, FileNameL, Title, ArtistID, AlbumID, GenreID, KeyID, LabelID, ComposerID, RemixerID, BPM, Length(sec), BitRate, BitDepth, Rating, ReleaseYear, ColorID, FileType, AnalysisDataPath. Metadati normalizzati in tabelle: DjmdArtist, DjmdAlbum, DjmdGenre, DjmdKey, DjmdColor, DjmdLabel"
        ],
        "cues": "POSITION_MARK (XML) attributi VERIFICATI da spec ufficiale Pioneer: Name; Type (Cue=\"0\", Fade-In=\"1\", Fade-Out=\"2\", Load=\"3\", Loop=\"4\"); Start (sec con decimali); End (sec con decimali, usato per i loop Type=4); Num = identificatore del mark. Mapping Num VERIFICATO nella spec 2011: Hot Cue A/B/C = \"0\"/\"1\"/\"2\"; Memory Cue = \"-1\". IMPORTANTE: la spec PDF ufficiale (2011) documenta solo 3 hot cue (A,B,C) perche allora esistevano solo quelle; il rekordbox moderno usa fino a 8 hot cue con Num 0-7 (A-H) e ha aggiunto al POSITION_MARK gli attributi Red/Green/Blue per il colore delle hot cue (documentati da pyrekordbox, NON presenti nel PDF 2011). Un loop e un POSITION_MARK con Type=\"4\" e End valorizzato; se Num=-1 e memory loop, se Num 0-7 e hot cue loop. master.db tabella DjmdCue (cue+hot cue) colonne: ID, ContentID, InMsec/OutMsec, InFrame/OutFrame (1/150 s), InMpegFrame/OutMpegFrame, Kind (0=memory cue, altrimenti=numero hot cue), Color (ColorID, -1 se assente), ActiveLoop, Comment (nome cue). ANLZ: hot/memory cue in tag PCOB (.DAT, max 3 hot cue, senza colore/commento) e PCO2 (.EXT, >3 hot cue con colore custom e commento testuale per cue).",
        "beatgrid": "TEMPO (XML) = beatgrid, attributi VERIFICATI da spec ufficiale: Inizio (posizione di inizio del beatgrid, secondi con decimali = posima ancora/downbeat), Bpm (float64), Metro (metro musicale, es. \"4/4\",\"3/4\",\"7/8\"), Battito (numero del beat nella battuta; se Metro=4/4 vale 1,2,3 o 4). Puo esserci PIU DI UN nodo TEMPO per traccia: uno solo per grid a tempo costante, piu nodi per beatgrid dinamici/variabili (ogni TEMPO e un marker di tempo/ancora). L'import ricostruisce la griglia dai marker TEMPO. La griglia interna ad alta risoluzione NON e nel master.db ma nei file ANLZ: tag PQTZ nel .DAT (beat con numero beat, tempo in BPMx100, tempo in ms) e PQT2 nel .EXT (versione estesa). Attenzione: BPM in ANLZ e memorizzato come BPM moltiplicato per 100 (intero).",
        "playlists": "XML PLAYLISTS = albero di <NODE> VERIFICATO da spec ufficiale. NODE radice: Type=\"0\" (FOLDER), Name=\"ROOT\", attributo Count = numero di NODE figli. Ogni NODE: Type=\"0\" (FOLDER, ha Count) oppure Type=\"1\" (PLAYLIST). Se Type=\"1\": attributi Entries (numero di TRACK nella playlist) e KeyType (\"0\"=Track ID, \"1\"=Location); i figli sono <TRACK Key=\"...\"> dove Key e il TrackID o la Location a seconda di KeyType. Le cartelle possono annidarsi (folder dentro folder) per playlist gerarchiche. master.db: playlist in DjmdPlaylist con ID, Seq (ordinamento), Name, ParentID (gerarchia cartelle, self-reference), Attribute (0=playlist, 1=folder, 4=smart playlist), SmartList (condizioni XML per gli smart). Appartenenza tracce in DjmdSongPlaylist (PlaylistID -> DjmdPlaylist.ID, ContentID -> DjmdContent.ID, con TrackNo/Seq per ordine). Stesso pattern ParentID+Seq per gerarchia.",
        "libs": [
          "pyrekordbox (Python, dylanljones) - libreria principale non ufficiale: legge/scrive XML (RekordboxXml), DB6/7 master.db (Rekordbox6Database, gestisce SQLCipher + download-key), file ANLZ e MySetting. GitHub github.com/dylanljones/pyrekordbox, docs pyrekordbox.readthedocs.io",
          "sqlcipher3-wheels - dipendenza usata da pyrekordbox per aprire il master.db cifrato (binari SQLCipher inclusi)",
          "crate-digger (Java, Deep Symmetry) - parsing dei file ANLZ/PDB, ottimo per la struttura binaria dei cue/beatgrid/waveform",
          "Documentazione ufficiale Pioneer 'rekordbox for Developers' (rekordbox.com/en/support/developer/) - fornisce solo la spec XML (PDF), NON il formato master.db",
          "Note pratiche sui limiti: manuale Lexicon DJ (lexicondj.com) e community Pioneer DJ / Mixxx"
        ],
        "gotchas": [
          "Hot cue XML: la spec ufficiale 2011 mappa solo 3 hot cue (Num 0-2); rekordbox moderno supporta 8 hot cue (Num 0-7, A-H). Import di file con piu di 8 hot cue: le eccedenti vengono scartate. VERIFICATO che il massimo software e 8 hot cue",
          "Colore memory cue: l'XML NON supporta il colore delle memory cue (VERIFICATO, manuale Lexicon: 'Memory cue colors are not exported because the XML does not support them'). Solo le hot cue hanno Red/Green/Blue nell'XML. Il colore memory cue esiste solo nel DB/ANLZ (metodo diretto)",
          "MyTag: NON esiste nell'XML (VERIFICATO Lexicon: 'the XML does not support MyTags'). I MyTag vivono solo nel master.db: DjmdMyTag (categorie/tag, ParentID, Seq, Attribute) + DjmdSongMyTag. Lexicon indica per il metodo diretto un limite di 4 categorie e 128 tag (dato riportato da Lexicon, NON confermato su fonte Pioneer)",
          "Smartlist/Smart Playlist: NON esportate in XML (VERIFICATO Lexicon). Nel DB sono DjmdPlaylist.Attribute=4 con condizioni in SmartList (XML)",
          "Loop attivi: l'XML NON preserva lo stato 'active loop' (VERIFICATO Lexicon: 'Active loops are not preserved because the XML does not support them'). Il loop resta come marker (Type=4) ma non parte in automatico. Nel DB c'e DjmdCue.ActiveLoop",
          "Ordine di scarto quando cue+loop superano il massimo: i loop vengono droppati per primi (riportato da fonti community, NON confermato su fonte Pioneer)",
          "XML import solo additivo/aggiornamento: non cancella tracce gia in rekordbox (VERIFICATO Lexicon)",
          "Location XML: deve essere URI 'file://localhost/...'; path errati o encoding sbagliato = traccia non collegata. Attenzione a spazi/caratteri speciali (percent-encoding)",
          "TotalTime in XML e in secondi SENZA decimali (troncato); AverageBpm invece con decimali - non confondere le unita",
          "master.db: e reverse engineering, nessuna API ufficiale di scrittura; scrivere col DB aperto in rekordbox puo corrompere/creare conflitti di sync (colonne USN, updated_at). Sempre backup + rekordbox chiuso",
          "Chiave SQLCipher del master.db offuscata nelle versioni recenti di rekordbox 6: serve estrarla/scaricarla (pyrekordbox download-key). Versione esatta del cambio NON verificata",
          "Beatgrid: l'XML (TEMPO) e a bassa risoluzione (marker di tempo); la griglia fine e nei file ANLZ (PQTZ), con BPM x100 come intero"
        ],
        "sources": [
          "https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf (spec XML ufficiale Pioneer, estratta verbatim: Rating 0/51/102/153/204/255; POSITION_MARK Type Cue0/FadeIn1/FadeOut2/Load3/Loop4; Num HotCue A,B,C=0,1,2 e Memory=-1; TEMPO Inizio/Bpm/Metro/Battito; Colour 8 colori; NODE Type/KeyType/Entries)",
          "https://rekordbox.com/en/support/developer/ (pagina ufficiale rekordbox for Developers)",
          "https://pyrekordbox.readthedocs.io/en/latest/formats/xml.html (struttura XML, POSITION_MARK con Red/Green/Blue, mapping cue)",
          "https://pyrekordbox.readthedocs.io/en/latest/formats/db6.html (master.db SQLite+SQLCipher4, tabelle DjmdContent/DjmdCue/DjmdPlaylist/DjmdSongPlaylist/DjmdMyTag/DjmdSongMyTag/DjmdColor/DjmdKey; DjmdCue.Kind 0=memory)",
          "https://pyrekordbox.readthedocs.io/en/latest/formats/anlz.html (ANLZ: PQTZ beatgrid, PCOB max 3 hot cue, PCO2 hot cue con colore/commento)",
          "https://pyrekordbox.readthedocs.io/en/latest/tutorial/db6.html (uso Rekordbox6Database, SQLCipher)",
          "https://github.com/dylanljones/pyrekordbox (repo libreria pyrekordbox)",
          "https://github.com/dylanljones/pyrekordbox/discussions/113 (scrittura hot cue/memory cue nel DB)",
          "https://www.lexicondj.com/manual/sync-rekordbox-xml (limiti XML: no MyTag, no memory cue color, no active loop, no smartlist, solo add/update)",
          "https://mixedinkey.com/rekordbox-cue-points/ (contesto hot cue vs memory cue in rekordbox)"
        ]
      },
      {
        "app": "Native Instruments Traktor Pro (2.x / 3.x / 4.x). Il file di libreria e' la \"Track Collection\" in formato NML.",
        "formatType": "NML = file XML in chiaro, UTF-8. Header: <?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?> poi <NML VERSION=\"19\"> (l'attributo VERSION cambia con la major: ~19 per TP3). Struttura: <NML> > <HEAD COMPANY=\"www.native-instruments.com\" PROGRAM=\"Traktor\"/> > <MUSICALKEY.../> (tabella indici) > <COLLECTION ENTRIES=\"n\"> con un <ENTRY> per traccia > <SETS> > <PLAYLISTS> (alberatura cartelle/playlist) > <INDEXING>. Ogni <ENTRY> contiene i figli LOCATION, INFO, TEMPO, LOUDNESS, MUSICAL_KEY, e zero+ CUE_V2, piu' eventuali STEMS/MODIFICATION_INFO. NON esiste un XSD ufficiale: la struttura e' reverse-engineered dalla community. VERIFICATO su fixture reale (NML VERSION=\"19\") e sul doc reverse-engineered \"plow\".",
        "location": "Windows: C:\\Users\\<utente>\\Documents\\Native Instruments\\Traktor <versione>\\collection.nml (es. \"Traktor 3.5.1\"). macOS: ~/Documents/Native Instruments/Traktor <versione>/collection.nml (Users/<utente>/Documents/Native Instruments/...). La cartella \"Root Directory\" porta SEMPRE il numero di versione con cui e' stata creata; a ogni update Traktor crea una nuova Root Directory con relativi backup. Nella stessa cartella ci sono i .bak/backup. Il percorso puo' essere ridefinito dall'utente nelle preferenze (File & Dir), quindi non e' garantito che stia li'. VERIFICATO (manuale NI + support NI + guida MIXO).",
        "readable": "Molto leggibile: e' XML piatto, parsabile con qualsiasi libreria XML (ElementTree, lxml, xml2js, ecc.). ENTRY: attributi MODIFIED_DATE (YYYY/M/D, senza zero iniziale), MODIFIED_TIME (secondi dopo mezzanotte UTC), TITLE, ARTIST, AUDIO_ID (fingerprint proprietario NI, non decodificato). LOCATION: DIR (tutte le cartelle, separatore \"/:\", HTML-encoded con &amp;), FILE (nome file), VOLUME (nome volume/lettera), VOLUMEID. INFO: BITRATE (bit/s), GENRE, COMMENT, KEY (stringa testo chiave es \"10m\"/\"2d\"), PLAYTIME (secondi, puo' essere arrotondato), RANKING (rating), IMPORT_DATE, RELEASE_DATE, PLAYCOUNT, FLAGS, FILESIZE. Esempio reale verificato: <ENTRY MODIFIED_DATE=\"2019/10/19\" TITLE=\"Dubstep 1\" ARTIST=\"Loopmasters\"><LOCATION DIR=\"/:Library/:Application Support/:...\" FILE=\"Loopmasters_Dubstep1.mp3\" VOLUME=\"osx\" VOLUMEID=\"osx\"/><INFO BITRATE=\"189720\" GENRE=\"Dubstep\" KEY=\"10m\" PLAYTIME=\"193\"/><TEMPO BPM=\"139.999924\" BPM_QUALITY=\"100.000000\"/><MUSICAL_KEY VALUE=\"12\"/>...</ENTRY>.",
        "writable": "Scrivibile a mano (XML), ma con cautele. traktor-nml-utils avverte esplicitamente: \"While reading should work in 99% cases, writing NML files hasn't been tested thoroughly enough yet, so always keep a copy of your NML files\". Regole pratiche per scrivere senza corrompere: (1) Traktor DEVE essere chiuso mentre modifichi collection.nml, altrimenti alla chiusura sovrascrive; (2) fai backup del file (Traktor stesso tiene .bak nella Root Directory); (3) il KEY di una traccia in playlist deve combaciare ESATTAMENTE con VOLUME + DIR + FILE dell'ENTRY nella COLLECTION (stringa con separatori \"/:\" e HTML-encoding), altrimenti la voce di playlist resta \"orfana\"; (4) mantieni gli attributi COUNT/ENTRIES/COLLECTION ENTRIES coerenti col numero reale di nodi; (5) rispetta i decimali (BPM e START usano float ad alta precisione). RATING/rating (RANKING) scrivibile ma va nel range a step di 51.",
        "fields": [
          "ENTRY: MODIFIED_DATE, MODIFIED_TIME, TITLE, ARTIST, AUDIO_ID (fingerprint NI non documentato), LOCK, LOCK_MODIFICATION_TIME",
          "LOCATION: DIR (separatore '/:', HTML-encoded), FILE, VOLUME, VOLUMEID",
          "INFO: BITRATE, GENRE, COMMENT, LABEL, KEY (testo, es. '10m'), PLAYTIME, PLAYCOUNT, RANKING (rating), IMPORT_DATE, RELEASE_DATE, FLAGS, FILESIZE, KEY_LYRICS",
          "TEMPO: BPM (float 3+ decimali), BPM_QUALITY (di norma 100)",
          "MUSICAL_KEY: VALUE (intero, indice chiave interno Traktor)",
          "LOUDNESS: PEAK_DB, PERCEIVED_DB, ANALYZED_DB (autogain/normalizzazione)",
          "CUE_V2: NAME, DISPL_ORDER, TYPE, START (ms, float), LEN (ms, 0 se non loop), REPEATS (-1), HOTCUE (0-7 o -1)",
          "RANKING/rating: memorizzato in INFO@RANKING, ogni stella = 51 -> 0=0*, 51=1*, 102=2*, 153=3*, 204=4*, 255=5*"
        ],
        "cues": "CUE_V2 (uno per punto). Attributi: NAME (etichetta: 'AutoGrid', 'n.n.' = senza nome, o custom), DISPL_ORDER (di norma 0), TYPE (intero = tipo cue), START (posizione in MILLISECONDI, float ad alta precisione es START=\"52.315876\"), LEN (lunghezza in ms; 0 se non e' un loop), REPEATS (di norma -1), HOTCUE (numero slot 0-7; -1 = non assegnato a hotcue, cioe' cue \"invisibile\"/solo memoria). Mappa TYPE (convenzione community, verificata su fixture e forum): 0 = Cue (hot cue standard), 1 = Fade-In, 2 = Fade-Out, 3 = Load (marker di caricamento), 4 = Grid (AutoGrid/beat marker della griglia), 5 = Loop (in questo caso LEN>0 definisce la durata). Esempio reale verificato: <CUE_V2 NAME=\"AutoGrid\" TYPE=\"4\" START=\"52.315876\" LEN=\"0.000000\" REPEATS=\"-1\" HOTCUE=\"0\"/> e <CUE_V2 NAME=\"n.n.\" TYPE=\"0\" START=\"52.315876\" LEN=\"0.000000\" REPEATS=\"-1\" HOTCUE=\"7\"/>. Nota: Traktor gestisce fino a 8 hotcue (0-7); i cue con HOTCUE=-1 esistono ma non occupano uno slot pad.",
        "beatgrid": "La beatgrid NON e' una lista di tutte le linee: e' data da DUE informazioni. (1) <TEMPO BPM=\"...\" BPM_QUALITY=\"...\"/> dentro l'ENTRY = BPM globale (float, es 139.999924; BPM_QUALITY di norma 100). (2) un CUE_V2 di tipo griglia con TYPE=\"4\" e NAME=\"AutoGrid\" (o \"Beat Marker\"): il suo START (in ms) fissa la posizione del primo downbeat/ancora. Da BPM + posizione del grid marker Traktor ricostruisce tutte le gridline (una battuta = 60000/BPM ms), assumendo tempo costante. Sono ammessi piu' grid marker per gestire variazioni di tempo, ma l'AutoGrid base ne ha uno. Il grid marker e' tipicamente taggato a un hotcue (spesso HOTCUE=0). Con LOCK a livello ENTRY la griglia/analisi viene \"bloccata\" e Traktor puo' salvarla anche nei tag ID3 del file. GOTCHA cross-software: convertendo verso Rekordbox su file MP3 c'e' uno sfasamento noto di ~26 ms nella griglia dovuto a differenze di decoding MP3, che i tool di conversione compensano.",
        "playlists": "Sezione <PLAYLISTS> con alberatura a NODE. Radice: <NODE TYPE=\"FOLDER\" NAME=\"$ROOT\"> che contiene <SUBNODES COUNT=\"n\"> con dentro altri NODE. Cartella: <NODE TYPE=\"FOLDER\" NAME=\"...\"> > <SUBNODES COUNT=\"n\">. Playlist: <NODE TYPE=\"PLAYLIST\" NAME=\"Deep House\"> > <PLAYLIST ENTRIES=\"43\" TYPE=\"LIST\" UUID=\"fc3c87f22859469f938cc9a86dc1e685\">. Ogni traccia nella playlist e' <ENTRY><PRIMARYKEY TYPE=\"TRACK\" KEY=\"...\"/></ENTRY>. Il KEY e' il percorso completo con lettera drive (Win)/nome volume (Mac), HTML-encoded, separatore \"/:\" (es KEY=\"Macintosh HD/:Users/:max/:Music/:Maxwell &amp; Millfield/:Tracks/:Deep House/:01 - Ready...mp3\"). Questo KEY deve combaciare con VOLUME+DIR+FILE dell'ENTRY nella COLLECTION per collegare la voce alla traccia reale. Gli attributi COUNT (SUBNODES) ed ENTRIES (PLAYLIST) devono restare coerenti col numero effettivo di figli. Le cartelle possono annidarsi a piu' livelli (FOLDER dentro FOLDER). Esiste anche <SETS> per gli storici. VERIFICATO (psobot/traktor.py + plow doc + vibedrive wiki).",
        "libs": [
          "wolkenarchitekt/traktor-nml-utils (Python, PyPI 'traktor-nml-utils'): legge/scrive collection e history NML da Traktor 2.x-4.x; dataclass type-safe generate con xsdata; richiede Python >=3.10. API: TraktorCollection(path).nml.collection.entry ; entry.cue_v2.append(...); collection.save(). Avviso ufficiale: la scrittura non e' testata a fondo, tenere backup",
          "psobot/traktor (Python): parser semplice di collection.nml, buon riferimento per struttura PLAYLISTS/NODE/PRIMARYKEY e per costruire il KEY = VOLUME+DIR+FILE",
          "digital-dj-tools/dj-data-converter (axeldelafosse/dj-data-converter, Clojure/CLI): conversione bidirezionale Traktor NML <-> Rekordbox XML, gestisce cue/loop/beatgrid/key",
          "maxwell-and-millfield/plow: contiene 'collection (reverse engineered).nml.xml', la documentazione reverse-engineered piu' completa degli attributi",
          "rosstroha/traktor-key-converter e iammordaty/key-tools: conversione notazione chiavi (Open Key/Camelot) usata da Traktor",
          "Nessun XSD/SDK ufficiale Native Instruments: tutte queste librerie sono community e reverse-engineered"
        ],
        "gotchas": [
          "Nessuno schema ufficiale: il formato e' reverse-engineered, alcuni attributi (AUDIO_ID, FLAGS, ANALYZED_DB) non sono documentati",
          "START e LEN dei CUE_V2 sono in MILLISECONDI come float ad alta precisione, non in secondi ne' in campioni",
          "RANKING (rating) NON e' 0-5: e' 0-255 a step di 51 (51=1 stella ... 255=5 stelle)",
          "La beatgrid e' implicita: solo BPM (TEMPO) + posizione del grid marker (CUE_V2 TYPE=4), non un elenco di linee; assume tempo costante salvo piu' marker",
          "Il separatore di percorso e' '/:' (non '/' ne' '\\') e le stringhe sono HTML-encoded (& -> &amp;); sbagliarlo rompe il collegamento playlist<->traccia",
          "Il PRIMARYKEY KEY della playlist deve combaciare ESATTAMENTE con VOLUME+DIR+FILE della ENTRY, altrimenti voce orfana",
          "Traktor va CHIUSO durante la modifica del file, altrimenti sovrascrive le tue modifiche alla chiusura",
          "Gli attributi contatore (COLLECTION ENTRIES, SUBNODES COUNT, PLAYLIST ENTRIES) vanno tenuti coerenti col numero reale di elementi",
          "La cartella libreria contiene il numero di versione e cambia a ogni update: la collection 'attiva' potrebbe essere in una cartella versione diversa da quella attesa; l'utente puo' anche spostarla via preferenze",
          "Solo 8 hotcue (0-7); cue con HOTCUE=-1 esistono ma non occupano pad",
          "Traktor scrive VERSION del NML in evoluzione (~19 per TP3); tool tarati su una versione possono incontrare tag nuovi in TP4",
          "Cross-conversione MP3 verso Rekordbox: offset beatgrid ~26 ms da compensare per differente decoding MP3",
          "MUSICAL_KEY@VALUE (intero) e INFO@KEY (testo, es '10m') sono due campi distinti e possono non coincidere: VALUE e' la chiave rilevata da Traktor, KEY e' spesso una stringa da tag/import",
          "La scrittura NML delle librerie community e' meno affidabile della lettura: fare sempre backup"
        ],
        "sources": [
          "https://github.com/wolkenarchitekt/traktor-nml-utils",
          "https://pypi.org/project/traktor-nml-utils/",
          "https://github.com/wolkenarchitekt/traktor-nml-utils/blob/master/tests/fixtures/collection.nml",
          "https://github.com/maxwell-and-millfield/plow/blob/master/doc/collection%20(reverse%20engineered).nml.xml",
          "https://github.com/psobot/traktor/blob/master/traktor.py",
          "https://github.com/vibedrive/vibedrive/wiki/Traktor",
          "https://www.native-instruments.com/ni-tech-manuals/traktor-pro-manual/en/managing-your-track-collection",
          "https://support.native-instruments.com/hc/en-us/articles/209590729-How-to-Restore-the-TRAKTOR-Track-Collection-from-a-Backup",
          "https://www.native-instruments.com/ni-tech-manuals/traktor-pro-manual/en/advanced-usage-tutorials",
          "https://www.mixo.dj/guides/traktor-to-rekordbox",
          "https://www.mixo.dj/roadmap/2809-import-traktor-cue-types",
          "https://github.com/digital-dj-tools/dj-data-converter",
          "https://github.com/rosstroha/traktor-key-converter",
          "https://github.com/iammordaty/key-tools",
          "https://support.native-instruments.com/hc/en-us/articles/210311665-How-to-Set-Beatgrids-in-TRAKTOR"
        ]
      },
      {
        "app": "Serato DJ Pro / Serato DJ Lite (ex ScratchLive). La libreria e memorizzata in DUE posti complementari: (1) file di database e crate nella cartella _Serato_, e (2) metadati per-traccia scritti direttamente dentro i file audio come tag GEOB/ID3 (o equivalenti MP4/FLAC/Ogg). Serato scrive i dati in entrambi: il database e un indice/cache, ma la verita analitica (cue, beatgrid, overview) vive anche nei tag del file, cosi le tracce restano portabili tra drive/installazioni.",
        "formatType": "Formato binario proprietario, reverse-engineered (non ufficiale). Due famiglie di formato:\n\n1) DATABASE + CRATE (dentro _Serato_): envelope binario \"tag-length-value\". Ogni record = [4 byte tag ASCII][4 byte lunghezza uint32 BIG-ENDIAN][payload]. Il prefisso del tag determina la codifica del payload:\n- o* = sequenza annidata di record (es. otrk = un track record)\n- t* = testo UTF-16 BIG-ENDIAN (es. tsng titolo, tart artista)\n- p* = path UTF-16 BE relativo alla root del drive (es. pfil, ptrk)\n- u* = intero unsigned 32-bit BE (es. date/flag)\n- s* = intero signed 32-bit BE\n- b* = singolo byte\n- vrsn = stringa di versione (es. \"1.0/Serato ScratchLive Crate\")\nLo stesso envelope e usato sia da \"database V2\" sia dai file .crate.\n\n2) TAG PER-FILE (dentro i file audio): blob binari incapsulati e (per la maggior parte) base64-encoded, con linefeed \\n ogni 72 caratteri. Ogni tag ha propri version-byte e layout binario. In MP3/AIFF sono frame GEOB ID3v2 (Serato usa ID3v2.4, ma legge anche 2.3); in MP4/M4A sono atom freeform \"----\" con mean com.serato.dj; in FLAC/Ogg sono VORBIS_COMMENT.",
        "location": "Cartella _Serato_ nella root di OGNI drive che contiene musica (una per drive; quella del drive di sistema tipicamente in ~/Music/_Serato_ su macOS o Music\\_Serato_ su Windows). Contenuto rilevante:\n- _Serato_/database V2  -> file (senza estensione) con l'indice di TUTTE le tracce e i loro metadati/percorsi (stesso envelope tag-length-value; contiene molti record otrk).\n- _Serato_/Subcrates/NomeCrate.crate  -> un file .crate per ogni crate. Il nome del crate e SOLO nel filename, non e codificato dentro il binario. Le gerarchie (sub-crate) si esprimono nel filename con separatore \"%%\" (es. \"Genere%%House.crate\").\n- _Serato_/Subcrates/*.scrate  -> smart crate (crate con regole/filtri).\n- _Serato_/SmartCrates -> (in alcune versioni) smart crates.\n- _Serato_/Metadata/ -> per file AAC/alcuni formati, dati salvati in XML esterno perche il contenitore non supporta i tag nativi.\n- Altri: NeuralMix, Recording, History/ (sessioni), .lock, ecc.\nI metadati per-traccia (cue, beatgrid, overview...) sono invece DENTRO il file audio, non nella cartella _Serato_.",
        "readable": "LETTURA: pienamente fattibile e ben documentata. Il formato e stato reverse-engineered in dettaglio dal progetto Mixxx e da Jan Holthuis (Holzhaus/serato-tags), e esistono parser funzionanti in Python. Sia l'envelope del database/crate sia i blob GEOB base64 sono decodificabili in modo deterministico. Nessuna cifratura: e solo binario impacchettato + base64. La lettura e a basso rischio (read-only sul file). Attenzione: per i tag per-file serve una libreria di tagging (mutagen) per estrarre i frame GEOB/atom/vorbis-comment prima di parsare il payload interno.",
        "writable": "SCRITTURA: fattibile ma con rischio piu alto e alcune incognite. E' quello che fanno strumenti come serato-tools (bvandrc), seratopy e python-serato-crates. Punti chiave verificati:\n- CRATE (.crate): scrittura affidabile e semplice — basta ricostruire l'envelope con vrsn + record otrk/ptrk. Seratopy e python-serato-crates lo fanno. E' l'operazione di scrittura piu sicura.\n- TAG PER-FILE (cue/beatgrid/color): scrivibili ri-serializzando il blob e reincapsulandolo nel frame GEOB/atom via mutagen. Funziona ma alcuni byte restano \"unknown/reserved\" (es. il footer byte del BeatGrid, alcuni campi riservati dei marker), quindi vanno preservati/copiati dall'originale quando possibile.\n- DATABASE V2: modificabile (serato-tools lo fa, es. per rinominare file aggiornando i riferimenti), MA e sconsigliato senza backup: Serato scrive il database SOLO alla chiusura pulita, e sovrascrive le modifiche esterne se e in esecuzione. Va modificato con Serato CHIUSO.\nRaccomandazione universale delle stesse librerie: fare un BACKUP di _Serato_ e dei file audio prima di scrivere. Non e un'API ufficiale, quindi aggiornamenti di Serato possono cambiare il formato.",
        "fields": [
          "ENVELOPE record (database/crate): [tag 4B ASCII][len 4B uint32 BE][payload]",
          "vrsn = stringa versione formato (UTF-16 BE)",
          "otrk = track record (contenitore annidato)",
          "pfil / ptrk = path file relativo a root drive (UTF-16 BE)",
          "ttyp = tipo/estensione file",
          "tsng = titolo, tart = artista, talb = album, tgen = genere, tcom = commento, tgrp = grouping/label",
          "tbpm = BPM (testo), tkey = tonalita, tlen = durata, tbit = bitrate, tsmp = sample rate, tsiz = dimensione",
          "uadd/utme = date (uint32 BE), flag vari u*",
          "--- TAG GEOB PER-FILE (blob nel file audio) ---",
          "Serato Autotags = BPM + auto gain + gain dB come STRINGHE ASCII null-terminated (non float), header 01 01",
          "Serato Overview = dati waveform, header 01 05, blocchi da 16 uint8 (info di frequenza per colonna)",
          "Serato Analysis = versione dell'analizzatore Serato",
          "Serato Autogain / SERATO_RELVOL / relvol = volume relativo",
          "Serato Offsets_ = solo MP3 (compensazione encoder-delay)",
          "Serato VideoAssoc / videoassociation = associazione video",
          "Nomi tag per formato: ID3 GEOB 'Serato Markers2' etc.; FLAC 'SERATO_MARKERS_V2'; MP4 '----:com.serato.dj:markersv2'; Ogg 'serato_markers2'"
        ],
        "cues": "HOT CUE / LOOP — memorizzati in due tag alternativi (Serato scrive entrambi per compatibilita):\n\n=== Serato Markers2 (formato nuovo, principale) ===\nStruttura tag: [01 01][base64 del payload, con \\n ogni 72 char][00][padding a null fino a >=470 byte].\nPayload decodificato: inizia con 01 01, poi una sequenza di ENTRY, termina con 00.\nOgni entry = [nome tipo ASCII null-terminated][len 4B uint32 BE][dati].\nTipi di entry:\n- COLOR: 3 byte RGB (es. 99 ff 99 = #99FF99) -> colore traccia. (spesso preceduti da 1 byte 00)\n- CUE: byte0 = indice (uint8); byte1-4 = posizione in ms (uint32 BE); byte5-7 = RGB (3B); byte8-9 = riservati; byte10+ = nome UTF-8 null-terminated.\n- LOOP: byte0 = indice; byte1-4 = start ms (uint32 BE); byte5-8 = end ms (uint32 BE); byte9-12 = colore ARGB (4B); byte13 = locked (bool); byte14+ = nome UTF-8 null-terminated.\n- BPMLOCK: 1 byte bool (beatgrid bloccato).\n- FLIP: indice + enabled + nome + subentry (feature Flip).\n\n=== Serato Markers_ (formato vecchio, legacy) ===\nHeader: 2B versione + uint32 BE numero entry (tipicamente 14 = 8 cue + 5 loop? in pratica 14 slot fissi). Poi 14 entry da 22 byte:\n- 0x00 flag start (0x00 set / 0x7f unset)\n- 0x01 start position (serato32, ms; 0x7f7f7f7f se unset)\n- 0x05 flag end\n- 0x06 end position (serato32)\n- 0x0a 6 byte riservati (~00 7f7f7f7f7f)\n- 0x10 colore (serato32, RGB su 4 byte)\n- 0x14 tipo (uint8: 1=Cue, 3=Loop)\n- 0x15 locked (bool)\nFooter: 4 byte = colore traccia (serato32).\nNB: 'serato32' e una codifica su 4 byte che distribuisce i bit RGB/posizione su 4 byte a 7 bit ciascuno (evita byte alti/0x7f). Markers2 NON la usa perche e gia base64.\nCOLORI: Serato usa una palette fissa; il valore RGB salvato e il colore reale mostrato. Nomi cue = testo UTF-8 dentro l'entry CUE di Markers2.",
        "beatgrid": "BEATGRID — tag \"Serato BeatGrid\" (ID3 GEOB) / SERATO_BEATGRID (FLAC) / beatgrid (MP4).\nLayout binario:\n- Header 6 byte: 2 byte versione (01 00) + uint32 BE = numero di marker.\n- Marker NON-terminale (8 byte ciascuno): float32 BE = posizione in secondi + uint32 BE = numero di beat fino al marker successivo. (Definisce sezioni a tempo costante tra due downbeat.)\n- Marker TERMINALE (8 byte, sempre esattamente uno, l'ultimo): float32 BE = posizione in secondi + float32 BE = BPM (il BPM che vale da quel punto fino a fine traccia).\n- Footer: 1 byte finale di valore ignoto/variabile (spesso trattato come \"unknown\" — da preservare copiandolo dall'originale in scrittura).\nInterpretazione: una griglia a BPM costante ha 1 solo marker terminale (posizione del primo beat + BPM). Griglie dinamiche (tempo variabile) usano piu marker non-terminali che scandiscono i cambi di tempo. Il BPM \"auto\" grezzo sta anche in Serato Autotags (come stringa ASCII).",
        "playlists": "CRATE = le \"playlist\" di Serato. Un crate per file .crate in _Serato_/Subcrates.\nStruttura interna del .crate (stesso envelope del database):\n- Record vrsn con \"1.0/Serato ScratchLive Crate\".\n- Record di configurazione colonne (osrt/tvcn/ovct ecc.) = ordinamento e colonne visibili.\n- Una sequenza di record otrk, ognuno contenente un ptrk = path del file RELATIVO alla root del drive (le lettere di drive Windows e lo slash iniziale POSIX vengono rimossi/aggiunti automaticamente). L'ordine dei otrk = ordine delle tracce nel crate.\nNome e gerarchia: il nome del crate NON e nel binario, e nel filename. I sotto-crate si codificano nel filename con \"%%\" (es. \"House%%Deep.crate\" = crate \"Deep\" dentro \"House\").\nSmart crate: file .scrate con regole/filtri invece di lista fissa.\nLIMITE IMPORTANTE sui path: i .crate memorizzano percorsi relativi al drive; una traccia puo stare in un crate solo se e sullo STESSO drive del _Serato_ che contiene quel crate (Serato tiene un _Serato_ per drive). La cronologia/history e separata in _Serato_/History.",
        "libs": [
          "Holzhaus/serato-tags (https://github.com/Holzhaus/serato-tags) — NON una libreria pip installabile ma la DOCUMENTAZIONE di riferimento del formato + script Python di dump (scripts/serato_markers2.py, tagdump.py). E' la fonte canonica del reverse engineering. Licenza permissiva.",
          "Mixxx (https://github.com/mixxxdj/mixxx) — implementazione C++ open source completa di lettura (parziale scrittura) dei tag Serato e del database/crate. Wiki con la spec del formato.",
          "seratopy — sharst (https://github.com/sharst/seratopy) — Python, focus su lettura/scrittura CRATE (load crate, add track, save). Semplice, solo crate.",
          "python-serato-crates — stephanlensky (https://github.com/stephanlensky/python-serato-crates), pip install serato-crate, Python 3.10+ — lettura E scrittura di file .crate, ben documentato (slensky.com/python-serato-crates).",
          "serato-tools — bvandrc (https://github.com/bvandrc/serato-tools), PyPI 'serato-tools', Python 3.12+ — il piu completo per SCRITTURA: modifica tag traccia (cue, beatgrid, color, autogain), crate, smart crate e database V2; beatgrid dinamico (numpy/librosa); waveform (pillow). Dipende da mutagen.",
          "Serato-lib — jesseward (https://github.com/jesseward/Serato-lib) — wrapper Python + documentazione del formato crate/library (piu datato, orientato Rane ScratchLive).",
          "mutagen (dipendenza chiave) — necessaria per leggere/scrivere i frame GEOB ID3, atom MP4 freeform e VORBIS_COMMENT dove risiedono i blob Serato."
        ],
        "gotchas": [
          "Formato NON ufficiale/undocumented: tutto e reverse-engineered. Serato puo cambiare il formato con un aggiornamento; nessuna garanzia di stabilita.",
          "Serato scrive il 'database V2' SOLO alla chiusura pulita dell'app e lo ri-flusha da zero: se modifichi il database mentre Serato e aperto, le tue modifiche vengono sovrascritte. Modifica sempre con Serato CHIUSO e fai backup.",
          "Doppio storage: cue/beatgrid stanno SIA nei tag del file SIA (come cache) nel database. Se scrivi nei tag ma non nel database, potresti dover forzare un re-read in Serato (o viceversa). La coerenza tra i due va gestita.",
          "Endianness: lunghezze e interi nel database/crate sono BIG-ENDIAN; il testo e UTF-16 BE. I blob GEOB usano float BE. Errori di endianness sono la trappola piu comune.",
          "Base64 con linefeed: i blob per-file sono base64 SENZA padding e con \\n ogni 72 caratteri; vanno rimossi/reinseriti correttamente o Serato ignora il tag.",
          "Markers2 ha padding a lunghezza minima (~470 byte) con null; alcune versioni sono piu tolleranti, ma conviene rispettarlo.",
          "Byte 'unknown'/reserved: footer del BeatGrid, campi riservati dei marker, version-byte — vanno PRESERVATI copiandoli dall'originale in scrittura, non azzerati.",
          "serato32: la codifica a 4x7bit usata da Markers_ (vecchio) per RGB/posizioni; Markers2 (nuovo) usa valori normali perche gia base64. Non confondere i due formati.",
          "Path relativi al drive nei .crate: una traccia deve stare sullo stesso volume del _Serato_ che contiene il crate; c'e un _Serato_ per ogni drive.",
          "Nome crate solo nel filename; gerarchia via '%%'. Rinominare/spostare crate = rinominare file, non toccare il binario.",
          "ID3: Serato scrive GEOB in ID3v2.4 ma per compatibilita a volte usa/legge 2.3; alcune app di tagging riscrivono/spostano i frame GEOB e possono corromperli. AIFF e WAV hanno gestione ID3 piu fragile.",
          "AAC/M4A puri: alcuni dati finiscono in _Serato_/Metadata come XML esterno perche il contenitore non ospita i blob nativi.",
          "Ogg Vorbis: la struttura dei marker differisce sensibilmente dagli altri formati (meno documentata) — trattare con cautela.",
          "Overview (waveform): rigenerabile da Serato; se scrivi cue/beatgrid ma non l'overview, Serato puo ricalcolarla. Non e critica per cue/beatgrid."
        ],
        "sources": [
          "https://github.com/mixxxdj/mixxx/wiki/Serato-Database-Format",
          "https://github.com/mixxxdj/mixxx/wiki/Serato-Metadata-Format",
          "https://github.com/Holzhaus/serato-tags",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/fileformats.md",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_markers2.md",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_beatgrid.md",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_markers_.md",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_overview.md",
          "https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_autotags.md",
          "https://homepage.rub.de/jan.holthuis/reversing-seratos-geob-tags.html",
          "https://github.com/mixxxdj/mixxx/pull/2495",
          "https://support.serato.com/hc/en-us/articles/204022904-What-is-in-the-Serato-folder",
          "https://github.com/sharst/seratopy",
          "https://github.com/stephanlensky/python-serato-crates",
          "https://slensky.com/python-serato-crates/",
          "https://github.com/bvandrc/serato-tools",
          "https://pypi.org/project/serato-tools/",
          "https://github.com/jesseward/Serato-lib"
        ]
      },
      {
        "app": "Engine DJ (Denon DJ / Engine Prime desktop / Engine OS su hardware SC5000/SC6000/Prime, Numark Mixstream). Stesso Engine Library condiviso tra desktop e player standalone.",
        "formatType": "Database SQLite (file .db). Colonne performance in BLOB binari zlib+qCompress (loops NON compresso). Verificato: fatti da documentazione/sorgenti, NON ho aperto un DB reale in questo progetto.",
        "location": "DUE ERE DI FORMATO. (1) LEGACY - Engine Prime 1.x / Engine OS <=1.6.1: cartella \"Engine Library/\" con m.db (metadati) + p.db (performance/analisi) + sm.db/sp.db (schema Serato). (2) ATTUALE - Engine 2.0+: cartella \"Engine Library/Database2/\" con UN SOLO m.db (metadati E performance insieme) + hm.db (history; ruolo non pienamente documentato - NON VERIFICATO al 100%). Presenti anche file .db-wal/.db-shm/.db-journal. La cartella Database2 sta sia su disco locale sia su chiavette/SSD esterni. Engine 4.0 ha rimosso il supporto ai DB legacy <=1.6.1 (migrazione via Engine 3.4.0).",
        "readable": "In sola lettura (aprire con ATTACH \"...m.db?mode=ro\") si legge tutto: metadati traccia (title/artist/album/genre/bpm/key/rating/anno/path/filename/fileType/fileBytes/durata), stato (isAnalyzed/isAvailable/isPlayed/timeLastPlayed/dateAdded), i BLOB di analisi (beatData, quickCues, loops, trackData, overviewWaveFormData), playlist/cartelle e loro ordine, history. Nel formato ATTUALE PerformanceData e' una VIEW sulla tabella Track (nel legacy era una tabella nel p.db separato). key traccia = intero 0-23 (mapping tipo Camelot). Posizioni in SAMPLE: dividere per sampleRate per avere secondi.",
        "writable": "Tecnicamente scrivibile (SQLite normale) ma con vincoli forti: NON modificare lo schema dei .db in Database2 o Engine rifiuta di caricare il DB e versioni future possono ripulire dati non conformi. Per aggiungere dati propri: DB separato in una sottocartella di Database2, con ATTACH, join su chiavi naturali. libdjinterop e piratengine scrivono con successo Track, cue, loop, beatgrid, waveform, crate e playlist. NON usare la PK \"id\" di SQLite come foreign key stabile: usa (originDatabaseUuid, originTrackId) per le tracce e il PlaylistPath per le playlist. Non tenere aperto un tool di terze parti mentre Engine DJ e' in esecuzione. Fare sempre backup.",
        "fields": [
          "FORMATO ATTUALE (Database2/m.db) - Tabella Track (PK id AUTOINCREMENT): playOrder, length, bpm(INT), bpmAnalyzed(REAL), year, path, filename, fileType, fileBytes, bitrate, title, artist, album, genre, comment, label, composer, remixer, key(INT 0-23), rating, albumArt/albumArtId, timeLastPlayed, isPlayed, isAnalyzed, dateCreated, dateAdded, isAvailable, isBeatGridLocked, originDatabaseUuid(TEXT), originTrackId(INT), uri, streamingSource/streamingFlags, explicitLyrics, activeOnLoadLoops",
          "BLOB di analisi ORA dentro Track: trackData, overviewWaveFormData, beatData, quickCues, loops",
          "Colonne con refuso reale nello schema: isPerfomanceDataOfPackedTrackChanged (manca la r), currentPlayedIndiciator - vanno usate cosi come sono",
          "Tabella Information (1 riga): uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch, currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter",
          "Playlist: id, title, parentListId(gerarchia cartelle), isPersisted, nextListId(ordine fratelli via linked-list), lastEditTime, isExplicitlyExported",
          "PlaylistEntity: id, listId, trackId, databaseUuid, nextEntityId(ordine tracce via linked-list; 0/null=fine), membershipReference. UNIQUE(listId, databaseUuid, trackId) -> una traccia una volta per playlist",
          "VIEW di supporto: PlaylistPath, PlaylistAllParent, PlaylistAllChildren, PerformanceData",
          "FORMATO LEGACY (m.db + p.db separati): m.db ha Track/MetaData(type=1 Title,2 Artist,3 Album,4 Genre,5 Comment...)/MetaDataInteger(type=4 key,5 rating...)/AlbumArt/Crate/CrateTrackList/Playlist/PlaylistTrackList(trackNumber)/Historylist. p.db ha PerformanceData(id, isAnalyzed, trackData, beatData, highResolutionWaveFormData, overviewWaveFormData, quickCues, loops)"
        ],
        "cues": "quickCues (BLOB, zlib+qCompress: 4 byte big-endian = lunghezza decompressa, poi payload zlib). Layout: uint64 count(=8), poi 8 frame a lunghezza variabile per gli 8 hot cue -> [labelLen(1 byte, 0=non impostato)] + [label ASCII senza terminatore] + [double posizione in sample little-endian, -1 se assente] + [colore ARGB: A=255,R,G,B]. Dopo gli 8 frame: double main-cue + byte override-flag + double default-cue autodetect. 8 colori predefiniti (hex): EAC532, EA8F32, B855BF, BA2A41, 86C64B, 20C67C, 00A8B1, 158EE2. loops (BLOB NON compresso): byte numLoops(=8) + 7 byte padding, poi 8 frame -> labelLen + label + double startSample(-1 se off) + double endSample(-1) + byte startSet + byte endSet + ARGB. trackData (BLOB compresso): double sampleRate + uint64 lengthSamples + double loudness/RMS(0-1) + uint32 key(0-23).",
        "beatgrid": "beatData (BLOB, zlib+qCompress). Contenuto decompresso: double sampleRate (8B) + double trackLengthSamples (8B) + 1 byte flag(=1) + DUE beatgrid consecutivi (grid1 default, grid2 adjusted/regolata). Ogni grid: uint64 numMarkers, poi N marker. Ogni marker (24 byte): double sampleOffset(LE, puo' essere negativo) + int64 beatIndex(LE, puo' essere negativo) + uint32 beatsToNextMarker + uint32 (campo ancora sconosciuto). Convenzione: PRIMO marker sempre \"beat -4\", ULTIMO marker sempre \"beat N+1\". BPM = sampleRate*60*(beatIndex_last - beatIndex_first)/(sampleOffset_last - sampleOffset_first). ATTENZIONE endianness: i double/int di posizione sono little-endian mentre il prefisso di lunghezza qCompress e' big-endian. Nota bug noto: Engine Prime/OS talvolta ricalcola erroneamente il BPM (libdjinterop issue #37).",
        "playlists": "Formato ATTUALE: gerarchia cartelle+playlist nella tabella Playlist via parentListId (root ha title vuoto). Ordine tra playlist sorelle = linked-list via nextListId. Appartenenza tracce in PlaylistEntity: ordine delle tracce dentro la playlist = linked-list via nextEntityId (0/null = ultima). UNIQUE(listId, databaseUuid, trackId): una traccia compare una sola volta per playlist. Chiave naturale playlist = PlaylistPath (sequenza ordinata dei titoli dei genitori dalla root fino alla playlist; esiste la VIEW PlaylistPath). Formato LEGACY: Playlist(id,title) + PlaylistTrackList(playlistId, trackId, trackNumber ordinamento) e Crate/CrateTrackList; la history in Historylist/HistorylistTrackList (date = timestamp UNIX).",
        "libs": [
          "libdjinterop (github.com/xsco/libdjinterop) - C++, LGPL-3.0, la piu completa. Supporta Engine OS 1.0.3-4.3.3 (SC5000, Mixstream Pro) e Engine Desktop/Prime 1.0.1-4.3.0. Legge/scrive tracce, beatgrid, hot cue, loop, waveform, crate, playlist. NON implementa album art e play history. Dipende da SQLite3+zlib (Boost per i test). Contiene i CREATE TABLE per ogni versione schema in src/djinterop/engine/schema/ (schema_1_6_0 ... schema_2_18_0/2_20_x/2_21_x ... schema_3_0_0/1/2)",
          "piratengine (github.com/ssabug/piratengine) - Python + Qt6, licenza WTFPL. Legge/scrive Track e playlist in m.db, export txt/json/m3u, riempimento metadati ID3. Testato su schema 2.20 e >=3 (nota: 3.3.0 aggiunge un parametro alla tabella Track)",
          "Mixxx - import da Engine DJ Desktop in sviluppo (issue #15090); il wiki Mixxx e' LA fonte di reverse engineering del formato",
          "Tool commerciali che sincronizzano con Engine (non open): Lexicon, DJ.Studio, Engine Sync App ufficiale"
        ],
        "gotchas": [
          "Due formati totalmente diversi: LEGACY m.db+p.db (Prime 1.x) vs ATTUALE Database2/m.db unico (Engine 2.0+). Engine 2.0+ NON e' retrocompatibile; Engine 4.0 rifiuta i DB legacy <=1.6.1 (migrazione via Engine 3.4.0). Rilevare la versione dalla tabella Information (schemaVersionMajor: 1=legacy, 2/3=Database2)",
          "NON alterare lo schema dei .db in Database2: Engine rifiuta il DB e versioni future possono ripulire righe non conformi. Ufficialmente non supportati i tool di terze parti (contatto developers@enginedj.com)",
          "NON usare la PK 'id' come foreign key stabile: usare (originDatabaseUuid, originTrackId) per le tracce e il PlaylistPath per le playlist (chiavi naturali persistenti). L'articolo ufficiale usa la scrittura 'originId/origingDatabaseUuid' con refusi: le colonne fisiche reali sono originTrackId e originDatabaseUuid",
          "Estensioni proprie: DB separato in sottocartella di Database2 + ATTACH in sola lettura + JOIN USING(originDatabaseUuid, originTrackId). Non eseguire il proprio tool mentre Engine DJ e' aperto",
          "Compressione: BLOB = qCompress (prefisso 4 byte big-endian con la lunghezza NON compressa, poi zlib). loops e' l'ECCEZIONE, NON compresso. zlib puro senza gestire il prefisso fallisce",
          "Endianness mista: prefisso lunghezza big-endian, ma i double/int di posizione dentro i payload sono little-endian",
          "Posizioni in SAMPLE, non in secondi: dividere per sampleRate (in trackData e beatData)",
          "Refusi bakati nello schema: colonne isPerfomanceDataOfPackedTrackChanged e currentPlayedIndiciator vanno usate col typo",
          "Ordine tracce/playlist e' una LINKED-LIST (nextEntityId / nextListId), non un semplice campo posizione: ricostruire l'ordine seguendo i puntatori",
          "Fragilita' schema-versione: layout dei BLOB cambia tra versioni; testare per versione. Bug noto di ricalcolo BPM (libdjinterop issue #37)",
          "hm.db (history) presente in Database2 ma con documentazione pubblica scarsa: ruolo/schema NON pienamente verificato",
          "Backup obbligatorio prima di scrivere; presenza di WAL (.db-wal/.db-shm) e journal da gestire con SQLite corretto"
        ],
        "sources": [
          "https://github.com/mixxxdj/mixxx/wiki/Engine-Library-Format",
          "https://support.enginedj.com/en/support/solutions/articles/69000834165",
          "https://support.denondj.com/en/support/solutions/articles/69000834165-engine-dj-v3-0-support-for-third-party-database-tools",
          "https://github.com/xsco/libdjinterop",
          "https://raw.githubusercontent.com/xsco/libdjinterop/main/src/djinterop/engine/schema/schema_2_20_1.cpp",
          "https://github.com/xsco/libdjinterop/tree/main/src/djinterop/engine/schema",
          "https://github.com/xsco/libdjinterop/issues/37",
          "https://github.com/ssabug/piratengine",
          "https://discuss.lexicondj.com/t/can-no-longer-export-sync-to-engine-dj/3599",
          "https://enginedj.com/kb/solutions/69000856026/engine-dj-unsupported-databases-for-engine-4-0",
          "https://enginedj.com/news/articles/engine-dj-v2-0-faq",
          "https://github.com/mixxxdj/mixxx/issues/15090"
        ]
      },
      {
        "app": "VirtualDJ (versioni 8 / 2021 / 2023 / 2024 / 2026: stessa struttura DB di base, con evoluzioni sul beatgrid). Fatti verificati su VDJPedia e forum ufficiali VirtualDJ + wiki Mixxx.",
        "formatType": "Un unico file XML di testo, database.xml, codifica UTF-8 (dal v6.0). Radice: elemento VirtualDJ_Database con attributo Version (es. Version='8.1'). Contiene una sequenza di elementi Song, ognuno con figli Tags, Infos, Scan, uno o piu Poi, e opzionalmente Comment, Link, CustomMix. Formato leggibile e semplice ma con requisiti di indentazione RIGIDI (vedi writable/gotchas). Nota: l'attributo Version del root e distinto da Scan/Version (es. 800/801) che e la versione del motore di analisi. Fonte: https://virtualdj.com/wiki/VDJ_database.html",
        "location": "Windows: cartella Documents/VirtualDJ/database.xml sotto C:/Users/<utente>/ (path reale con separatori backslash). Confermato VDJPedia. macOS: /Users/<utente>/Documents/VirtualDJ/database.xml (coerente col task e con la doc VDJ). NOTA riportata dalla community (non ri-verificata a fondo qui): VirtualDJ puo mantenere un database.xml SEPARATO nella root di ogni drive esterno (cartella VirtualDJ sulla radice del drive) per i brani che risiedono su quel drive; la libreria completa puo quindi essere spezzata su piu file database.xml. Le playlist NON stanno in questo file. Fonti: https://virtualdj.com/wiki/VDJ_database.html ; https://virtualdj.com/manuals/virtualdj/interface/database/playlists.html",
        "readable": "MOLTO FATTIBILE. E XML UTF-8 piano: qualsiasi parser (Python xml.etree.ElementTree o lxml, JS DOMParser, C# XmlDocument) itera i nodi Song e legge attributi/figli. Nessuna cifratura, nessun formato binario. Accortezze in LETTURA: (1) Scan.Bpm NON e il BPM ma il TEMPO IN SECONDI TRA DUE BATTITI: converti con BPM = 60 / Scan.Bpm (formula confermata da staff VDJ: 1/Bpm*60). (2) Poi.Pos e in secondi (float, es. 15.912449). (3) Poi.Color e un intero ARGB a 32 bit scritto in DECIMALE: es. 4278190081 = 0xFF000001, quindi A=0xFF R=0x00 G=0x00 B=0x01 (verificato con conversione numerica). (4) possono esistere piu file database.xml (Documents + uno per drive esterno) da fondere. Fonti: https://virtualdj.com/forums/226786/VirtualDJ_Technical_Support/Database_XML_properties.html ; https://github.com/mixxxdj/mixxx/wiki/Virtual-Dj-Cue-Storage-Format",
        "writable": "FATTIBILE MA DELICATO. Vincoli concreti e load-bearing: (1) VirtualDJ tiene il DB IN MEMORIA e RISCRIVE database.xml alla CHIUSURA: qualsiasi modifica esterna fatta mentre VDJ e aperto viene SOVRASCRITTA/persa. Regola pratica: chiudere VirtualDJ prima di scrivere, poi salvare. (2) INDENTAZIONE RIGIDA richiesta da VDJ (staff PhantomDeejay): l'elemento Song (parent) deve avere ESATTAMENTE UNO spazio davanti, mentre TUTTI i figli (Tags, Infos, Scan, Poi...) devono avere DUE spazi davanti; ogni elemento su una riga propria. I parser XML standard che ri-serializzano (es. MSXML/ElementTree con pretty print) alterano/rimuovono lo spazio iniziale e fanno segnalare a VDJ 'database corrotto'. Workaround: preservare il whitespace (in MSXML: preserveWhiteSpace=True) oppure ri-formattare a mano; in lxml/etree conviene fare edit mirati preservando la struttura o riscrivere le righe manualmente. (3) Mantieni tag self-closing, virgolette attributi, encoding UTF-8. (4) NON toccare gli attributi Flag (stato interno del DB: inclusione nei risultati di ricerca ecc.). (5) Fai SEMPRE un backup di database.xml prima di scrivere. Fonti: https://www.virtualdj.com/forums/233715/VirtualDJ_Technical_Support/Modify_Database_xml_-_Special_format.html ; https://virtualdj.com/forums/250181/VirtualDJ_Technical_Support/Explanation_of_xml-database__Flag__and__Tags_Flag__attribute.html",
        "fields": [
          "Song (elemento brano): attributi FilePath (percorso assoluto file audio), FileSize (byte), Flag (stato interno). Figli: Tags, Infos, Scan, Poi (0..n), Comment, Link, CustomMix.",
          "Tags (metadati editoriali): Author, Title, Remix/Remixer, Year, Genre, Album, TrackNumber, Composer, Label, Grouping, Bpm, Key, Stars (rating), User1, User2, Flag, Internal. Nota: Bpm/Key in Tags sono i valori 'tag' (editoriali) distinti dai valori 'Scan' (analisi).",
          "Infos (statistiche/proprieta): SongLength (durata in secondi), Bitrate, Cover, FirstSeen/FirstPlay/LastPlay (timestamp), PlayCount, Gain, Color, UserColor, Corrupted.",
          "Scan (risultati analisi): Version (motore, es. 800/801), Flag, Volume, Bpm (SECONDI tra due battiti, BPM=60/Bpm), AltBpm (secondo BPM piu probabile), Key (analizzata), Phase (ancora beatgrid 'fluid' nelle versioni recenti).",
          "Poi (Point of Interest, 0..n per brano): attributi Pos, Type, Point, Name, Num, Bpm, Size, Color, Slot (vedi campi cues/beatgrid per il dettaglio).",
          "Rating: attributo Stars dentro Tags (Song > Tags > Stars). Rappresenta il rating a stelle; intervallo atteso 0-5 (intero). NON pienamente confermato dalle fonti il formato numerico esatto: da verificare su un DB reale.",
          "Key: memorizzata in notazione MUSICALE (es. 'Am', 'C#m', 'G', 'B') sia in Scan.Key sia in Tags.Key; la visualizzazione Camelot/armonica (es. '03A') e una CONVERSIONE fatta dalla UI, il dato di base resta musicale. Fonte: https://virtualdj.com/forums/91426/General_Discussion/Camelot_Key_Format_in_VDJ_Browser.html",
          "Color (Infos.Color / Poi.Color / UserColor): intero ARGB a 32 bit in DECIMALE (es. 4278190081 = 0xFF000001)."
        ],
        "cues": "CUE POINTS e LOOP sono TUTTI Poi (Points of Interest) dentro Song. Attributi Poi rilevanti: Pos (posizione in secondi, float), Type, Name, Num, Color, Size, Slot, Point, Bpm. HOT CUE (default, Type spesso assente o 'cue'): esempio reale -> Poi con Name='Cue 1' Pos='15.912449' Num='1' Color='4278190081'. Num = numero del cue/pad (intero 1..n). Color = ARGB decimale (vedi sopra); influenza pad RGB dei controller e i marker nello skin. SAVED LOOP: Poi con Type='loop', piu Size (lunghezza del loop), Slot (slot del loop, richiamabile via VDJScript es. 'saved_loop 2'), piu Num, Color, Name. ATTENZIONE: le fonti confermano gli attributi Size e Slot per i loop, ma NON e confermato in modo definitivo se Size sia espresso in BATTUTE o in SECONDI (il POI Editor parla di lunghezza in 'beats', il valore XML potrebbe essere in secondi): DA VERIFICARE su un DB reale. Altri tipi di Poi (dal POI Editor): HotCue, Saved Loop, Action Point (macro VDJScript eseguita al passaggio), Remix Point (hot cue extra dai pad), Automix Point, Load Point (uno solo per file, punto di partenza al load). AUTOMIX: Poi con Type='automix' e attributo Point che specifica il sottotipo: realStart, realEnd, fadeStart, fadeEnd, cutStart, cutEnd (mix tempo/cut/fade/full start-exit). Fonti: https://github.com/mixxxdj/mixxx/wiki/Virtual-Dj-Cue-Storage-Format ; https://virtualdj.com/manuals/virtualdj/editors/poieditor.html",
        "beatgrid": "BPM: memorizzato in Scan.Bpm come TEMPO IN SECONDI TRA DUE BATTITI (BPM = 60 / valore; conferma staff: 1/Bpm*60). AltBpm = BPM alternativo. BEATGRID (ancora di fase): DUE rappresentazioni a seconda della versione. (A) LEGACY / classica: un Poi con Type='beatgrid' e Pos in secondi (es. Poi Pos='3.721451' Type='beatgrid'), che marca l'ancora della griglia; con griglia a BPM costante basta l'ancora + il Bpm. (B) VirtualDJ recente (2024/2026, 'fluid beatgrids'): l'ancora e spostata nell'attributo Phase dentro il blocco Scan, e la VDJ Stable NON scrive piu il Poi Type='beatgrid'. Questo rompe strumenti che leggono il vecchio Poi (es. SoundSwitch per l'auto-scripting luci). Il tool DeedjayNo1/beatgrid_fix e una implementazione di riferimento REALE che: legge Scan.Phase e (Mode FIX) crea il corrispondente Poi Pos=[Phase] Type='beatgrid'; (Mode CHECK) verifica la coerenza fra Poi beatgrid esistenti e Phase con una tolleranza, e marca i brani corretti con tag User1 (#SoundSwitch-FIX / #Beatgrid-FIX). Le 'fluid beatgrids' implicano possibili variazioni di griglia lungo il brano (piu ancore / griglia non a BPM costante). Fonti: https://github.com/DeedjayNo1/beatgrid_fix ; https://virtualdj.com/forums/226786/VirtualDJ_Technical_Support/Database_XML_properties.html",
        "playlists": "Le PLAYLIST NON sono dentro database.xml: sono file SEPARATI. VirtualDJ 2024+ ha unificato playlist e virtual folder in 'Lists' salvate in Documents/VirtualDJ/MyLists/ come file .vdjfolder (XML). Prima (2023 e precedenti): le playlist erano .m3u in Documents/VirtualDJ/Playlists/ e i virtual folder erano .vdjfolder in Documents/VirtualDJ/Folders/. Al primo avvio, VDJ 2024 converte automaticamente i vecchi .m3u nel nuovo formato Lists. Quindi per ricostruire le playlist/crates bisogna parsare separatamente i file .vdjfolder (XML) / .m3u, non database.xml. Fonti: https://virtualdj.com/manuals/virtualdj/interface/database/playlists.html ; https://virtualdj.com/forums/257603/General_Discussion/Breaking_changes_in_VirtualDJ_2024_(and_how_to_revert_to_vdj2023_if_you_need_to).html",
        "libs": [
          "Nessuna libreria dedicata matura/di riferimento univoca per VirtualDJ database.xml. Approccio raccomandato (anche da forum VDJ): parser XML generico. Python: xml.etree.ElementTree (stdlib) o lxml. JS: DOMParser / fast-xml-parser. C#/.NET: XmlDocument / XDocument. Ruby/PHP: qualsiasi lib XML.",
          "DeedjayNo1/beatgrid_fix (https://github.com/DeedjayNo1/beatgrid_fix): tool REALE che legge E scrive database.xml (POI beatgrid <-> Scan.Phase) per compatibilita SoundSwitch. Ottima implementazione di riferimento per read/write dei Poi e per gestire il whitespace/formattazione.",
          "take8jp/VirtualDJ-XML-Viewer (https://github.com/take8jp/VirtualDJ-XML-Viewer): visualizzatore web (HTML/JS/CSS) del database.xml, sola LETTURA. Utile come riferimento di parsing lato browser.",
          "mixxxdj/mixxx wiki 'Virtual Dj Cue Storage Format' (https://github.com/mixxxdj/mixxx/wiki/Virtual-Dj-Cue-Storage-Format): documentazione del formato POI/cue usata dagli importer; riferimento tecnico, non una libreria a se.",
          "Per scrivere in modo sicuro conviene NON usare il pretty-print automatico del parser ma fare edit mirati preservando l'indentazione richiesta (1 spazio Song, 2 spazi figli)."
        ],
        "gotchas": [
          "database.xml viene RISCRITTO da VirtualDJ alla chiusura: se scrivi mentre VDJ e aperto perdi le modifiche. Chiudi VDJ prima di scrivere.",
          "Indentazione RIGIDA: Song = 1 spazio davanti, figli = 2 spazi davanti; i serializzatori XML standard la rompono e VDJ segnala 'database corrotto'. Preserva il whitespace o riformatta a mano.",
          "BPM invertito: Scan.Bpm = secondi tra due battiti, converti con 60/valore. Sbagliare qui produce BPM assurdi.",
          "Color e un intero ARGB in DECIMALE (es. 4278190081 = 0xFF000001), non un esadecimale ne un nome colore.",
          "Pos e in SECONDI (float), non in campioni/ms.",
          "Possono esistere PIU file database.xml (Documents + uno per drive esterno): la libreria puo essere spezzata. FilePath e assoluto e va normalizzato per il matching dei file.",
          "Le PLAYLIST non sono in database.xml: parsare separatamente .vdjfolder (MyLists/Folders) e/o .m3u (Playlists).",
          "Beatgrid: VDJ 2024/2026 ('fluid beatgrids') sposta l'ancora in Scan.Phase e puo NON scrivere piu il Poi Type='beatgrid'; codice che si aspetta il vecchio Poi (es. per SoundSwitch) va adattato a leggere Phase.",
          "NON toccare gli attributi Flag (Song.Flag, Tags.Flag, Scan.Flag): stato interno del DB.",
          "NON confermato dalle fonti pubbliche: unita di misura di Poi.Size per i loop (battute vs secondi) e formato/range esatto di Tags.Stars (atteso 0-5). Verificare su un database.xml reale prima di scriverci.",
          "Backup obbligatorio di database.xml prima di ogni scrittura."
        ],
        "sources": [
          "https://virtualdj.com/wiki/VDJ_database.html",
          "https://github.com/mixxxdj/mixxx/wiki/Virtual-Dj-Cue-Storage-Format",
          "https://virtualdj.com/manuals/virtualdj/editors/poieditor.html",
          "https://www.virtualdj.com/forums/233715/VirtualDJ_Technical_Support/Modify_Database_xml_-_Special_format.html",
          "https://virtualdj.com/forums/226786/VirtualDJ_Technical_Support/Database_XML_properties.html",
          "https://virtualdj.com/forums/250181/VirtualDJ_Technical_Support/Explanation_of_xml-database__Flag__and__Tags_Flag__attribute.html",
          "https://github.com/DeedjayNo1/beatgrid_fix",
          "https://github.com/take8jp/VirtualDJ-XML-Viewer",
          "https://virtualdj.com/manuals/virtualdj/interface/database/playlists.html",
          "https://virtualdj.com/forums/257603/General_Discussion/Breaking_changes_in_VirtualDJ_2024_(and_how_to_revert_to_vdj2023_if_you_need_to).html",
          "https://virtualdj.com/forums/91426/General_Discussion/Camelot_Key_Format_in_VDJ_Browser.html"
        ]
      },
      {
        "app": "Panorama tool di conversione librerie DJ 2024-2025. Principali: (1) Lexicon DJ — app desktop Win/Mac, hub piu completo, conversione gratuita, gestione libreria + sync; supporta rekordbox, Serato, Traktor, Engine DJ, VirtualDJ, djay Pro. (2) MIXO (ex-website \"The DJ Library\") — libreria cloud + conversione, abbonamento (~7$/mese), ancora in beta, supporto rekordbox 6 export storicamente limitato. (3) Rekordcloud — servizio web ad abbonamento (~17$/mese), storicamente l'unico che gestiva l'export bloccato di Rekordbox 6. (4) DJCU (DJ Conversion Utility) — storicamente Mac, licenza one-time, multi-piattaforma (la pagina vendor rivendica \"market leader\" e v7.58 ad Apr 2026: CLAIM del venditore, NON verificato in modo indipendente). (5) dj-data-converter (digital-dj-tools) — CLI open source, Win+Mac, Traktor<->Rekordbox. (6) DJ Cue Bridge (djcuebridge.com) — convertitore di cue point gratuito segnalato per rekordbox/Serato/Traktor/Engine (non verificato in profondita). Nota: la maggioranza opera solo sui metadati nel DB del software DJ, i file audio non vengono spostati/toccati.",
        "formatType": "Ogni app DJ usa un formato proprietario, quindi la conversione e sempre un mapping tra schemi diversi. rekordbox: export/interscambio via rekordbox.xml (schema Pioneer con COLLECTION/TRACK, TEMPO, POSITION_MARK, PLAYLISTS/NODE); libreria nativa in SQLite (master.db, dalla v6 cifrato con SQLCipher) + file di analisi ANLZ (.DAT/.EXT). Serato: NON usa un DB centrale per cue/grid ma tag GEOB dentro l'ID3v2.3 dei file audio (Serato Markers_, Markers2, BeatGrid, Autotags, Overview) + crate come file .crate. Traktor: unico file XML collection.nml (NML, ENTRY/LOCATION/TEMPO/CUE_V2). Engine DJ (Denon): SQLite in Engine Library/Database2 (m.db metadati/playlist, p.db PerformanceData con BLOB cue/loop/beatgrid compressi zlib in formato Qt qCompress, prefisso lunghezza uint32; i loop invece NON compressi). VirtualDJ: XML (database.xml + POI). djay Pro: DB proprietario.",
        "location": "rekordbox: libreria nativa in %APPDATA%/Pioneer/rekordbox (Win) o ~/Library/Pioneer/rekordbox (Mac), file master.db + cartella share/ per gli ANLZ; l'XML e un file esportato scelto dall'utente. Serato: cartella _Serato_ (in Music/_Serato_ e/o alla radice di ogni drive) con database V2 e sottocartella Subcrates/*.crate; cue/grid pero risiedono DENTRO ogni file audio come tag GEOB. Traktor: ~/Documents/Native Instruments/Traktor x.x/collection.nml. Engine DJ: <drive>/Engine Library/Database2/ (m.db, p.db, ecc.); i percorsi traccia sono memorizzati RELATIVI alla root Engine Library. VirtualDJ: Documents/VirtualDJ/database.xml.",
        "readable": "Letture considerate affidabili (formato aperto/documentato): Traktor NML (XML in chiaro, parser maturo traktor-nml-utils); Serato (tag GEOB nei file + crate documentati da Holzhaus/serato-tags e Mixxx); rekordbox XML export; Engine DJ SQLite (Denon ha ufficializzato il supporto a tool di terze parti da Engine v3.0). Lettura fragile/complessa: libreria NATIVA rekordbox 6+ (master.db cifrato SQLCipher) — chiave e schema ricostruiti dalla community (pyrekordbox, crate-digger di Deep Symmetry), ma resta il caso piu difficile: secondo Digital DJ Tips storicamente solo Rekordcloud gestiva l'export bloccato di Rekordbox 6. Le conversioni piu \"pulite\" partono da sorgenti a formato aperto (Traktor/Serato) o dall'XML rekordbox piuttosto che dal DB binario.",
        "writable": "Scrittura affidabile verso: Serato (riscrittura tag GEOB nei file + crate); Traktor NML; rekordbox TRAMITE import di rekordbox.xml (percorso ufficiale e sicuro). Scrittura RISCHIOSA/lossy: (a) scrivere DIRETTAMENTE nel master.db di rekordbox — pyrekordbox segnala che per MP3 VBR il calcolo di InMpegAbs/InMpegFrame resta irrisolto, quindi i cue possono risultare spostati; consigliato usare la via XML. (b) Verso Traktor: TEMPO ha un solo valore BPM per traccia, quindi griglie dinamiche/variabili collassano in un unico BPM (dj-data-converter documenta esplicitamente questo limite). (c) Engine DJ: NON modificare lo schema dei .db (Engine si rifiuta di caricare il DB). (d) Se cue+loop eccedono la capacita del target, i tool (es. Lexicon) scartano prima i loop. Regola pratica: la conversione e quasi sempre asimmetrica, la fedelta dipende dalla coppia sorgente->destinazione, non dal tool.",
        "fields": [
          "Lexicon DJ: il piu completo e citato come piu affidabile/ampio nel 2024-2025; conversione gratuita, preserva playlist+struttura cartelle, cue/loop con colori+etichette, beatgrid; correzione automatica dello shift da encoding MP3",
          "MIXO: libreria cloud + conversione, abbonamento, beta, supporto rekordbox 6 export storicamente limitato",
          "Rekordcloud: web ad abbonamento, storicamente unico a gestire l'export bloccato di Rekordbox 6",
          "DJCU (DJ Conversion Utility): licenza one-time, multi-piattaforma, alcune coppie richiedono conversione in 2 passi (claim vendor v7.58/2026 NON verificato)",
          "dj-data-converter: CLI OPEN SOURCE, Traktor<->Rekordbox, ~10k tracce in <2 min; RB->Traktor con playlist solo in edizione Pro",
          "DJ Cue Bridge: convertitore gratuito di cue point (rekordbox/Serato/Traktor/Engine) - non verificato a fondo",
          "Campi metadati mappati tipicamente: artist, title, album, genre, BPM, key, track number, comment, rating, play count, date; il play count e il last played spesso NON sopravvivono (rekordbox non memorizza last played)"
        ],
        "cues": "Mapping dei cue verificato. rekordbox POSITION_MARK.Type: 0=Cue, 1=FadeIn, 2=FadeOut, 3=Load, 4=Loop; attributo Num: -1 = memory cue, 0..7 = hot cue A..H (rekordbox e l'UNICA app con \"memory cue\" oltre agli hot cue). Traktor CUE_V2.TYPE: 0=Cue, 1=FadeIn, 2=FadeOut, 3=Load, 4=Grid, 5=Loop; HOTCUE=-1 indica cue non-hotcue, 0..7 hotcue (fonte: ErikMinekus/traktor-scripts rekordbox-export.py e traktor-nml-utils). Il Loop Traktor(5) mappa a rekordbox Loop(4) calcolando end=start+LEN. Il Grid Traktor(4) NON diventa un POSITION_MARK ma un elemento TEMPO. Trucco tipico Traktor->rekordbox: ogni hot cue viene duplicato anche come memory cue (Num=-1). Serato: hot cue+loop+colori in GEOB Markers2 (posizione = int32 little-endian in ms, colore RGB, nome UTF-8 null-terminated); il vecchio Markers_ contiene i primi 5 hotcue + 9 loop + track color. Engine DJ: BLOB quickCues con max 8 hot cue (label, posizione in sample o -1 se vuoto, colore ARGB) + main cue separato. PERDITE tipiche: Traktor non ha cue COLORATI (i colori si perdono verso Traktor); i colori dei MEMORY cue rekordbox non passano via XML (solo hot cue); FLIP di Serato non converte; capacita hot cue -> Lexicon dichiara max 8 importati in rekordbox anche se ne supporta di piu (dato del solo manuale Lexicon).",
        "beatgrid": "rekordbox TEMPO: attributi Inizio (posizione in s), Bpm, Metro (es. 4/4, supporta time signature diverse), Battito (numero del beat nella battuta); supporta PIU punti di cambio BPM (\"BPM Change Points\"), quindi griglia dinamica. Traktor TEMPO: un solo BPM per traccia (+ BPM_QUALITY) con precisione a 6 decimali -> le griglie dinamiche/variabili collassano in un unico valore convertendo VERSO Traktor (limite esplicito in dj-data-converter). Serato BeatGrid: marker terminali e non-terminali (GEOB Serato BeatGrid). Engine DJ beatData: sistema ad ancore con due griglie (default + adjusted), sample rate + lunghezza come double, primo marker convenzionalmente \"beat -4\", ultimo un beat oltre l'ultimo utile. PROBLEMA CHIAVE trasversale: rekordbox/Serato/Traktor/VirtualDJ leggono i frame MP3 in modo diverso e su una piccola percentuale di tracce viene aggiunto silenzio all'inizio, spostando cue e beatgrid; dj-data-converter applica una correzione di offset di 26 ms, Lexicon riscansiona e corregge automaticamente in import/sync. Best practice: dopo la conversione verificare a campione l'allineamento della griglia su tracce MP3 VBR.",
        "playlists": "rekordbox: albero PLAYLISTS/NODE nell'XML (cartelle annidate + playlist); le smart/intelligent playlist si esportano come playlist STATICHE. Serato: i crate sono file .crate (struttura piatta; le sotto-cartelle si esprimono col naming del crate) e le smart crate sono separate. Traktor: nodo PLAYLISTS nell'NML con struttura a cartelle. Engine DJ: tabelle Playlist + PlaylistEntityList (relazione playlist<->tracce) in m.db. In pratica: la struttura a cartelle e le playlist normali si preservano bene con Lexicon/MIXO/Rekordcloud; le playlist INTELLIGENTI/smart diventano statiche (si perde la regola dinamica); dj-data-converter converte le playlist RB->Traktor solo in edizione Pro. Le playlist di STREAMING (TIDAL/Beatport/SoundCloud) e i remix set/Stems (solo Traktor) non sono portabili tra piattaforme.",
        "libs": [
          "dj-data-converter (github.com/digital-dj-tools/dj-data-converter) - CLI open source Traktor<->Rekordbox, riferimento per il mapping cue/tempo",
          "pyrekordbox (github.com/dylanljones/pyrekordbox) - legge/scrive rekordbox XML, master.db (SQLCipher) e file ANLZ; documenta il problema InMpegAbs per MP3 VBR",
          "serato-tags + writeup di Jan Holzhaus (github.com/Holzhaus/serato-tags) - documentazione byte-level dei tag GEOB Serato (Markers_, Markers2, BeatGrid)",
          "traktor-nml-utils (github.com/wolkenarchitekt/traktor-nml-utils) - parsing/modifica NML (Traktor 2.x/3.x), classi CUE_V2",
          "Mixxx wiki (github.com/mixxxdj/mixxx/wiki) - specifiche Serato-Metadata-Format ed Engine-Library-Format",
          "crate-digger (Deep Symmetry) - parser dell'export su dispositivo rekordbox (DeviceSQL/ANLZ)",
          "ErikMinekus/traktor-scripts rekordbox-export.py - implementazione di riferimento del mapping enum cue Traktor->rekordbox",
          "serato-tools (github.com/bvandrc/serato-tools, PyPI) - lettura/scrittura cue/beatgrid/crate + analisi beatgrid dinamica"
        ],
        "gotchas": [
          "MODELLO INTERMEDIO UNIVERSALE: convertire non da A->B direttamente ma A->schema neutro->B. Nel modello neutro normalizzare: posizioni in unita assoluta (ms o sample), colore in ARGB, un enum unico dei tipi cue (cue/hotcue/memory/loop/fadein/fadeout/load/grid), e separare hot cue da memory cue perche solo rekordbox ha entrambi.",
          "NORMALIZZAZIONE KEY / CAMELOT: usare la notazione Camelot (1A-12B) come pivot. rekordbox e Mixed In Key sono nativi Camelot; Traktor usa Open Key (1m-12d) che mappa 1:1 su Camelot (1A=Open? verificare: Open Key <-> Camelot e uno shift fisso); Serato accetta sia Camelot sia notazione musicale. Convertire sempre passando per Camelot/Open Key gestendo enarmonie.",
          "PATH RELOCATION: ogni app codifica i percorsi diversamente. Traktor: attributo DIR con separatore '/:' + VOLUME/VOLUMEID (nome volume, non lettera drive). Engine DJ: path RELATIVO alla root Engine Library. rekordbox XML: URL file://localhost/ URL-encoded. VirtualDJ/Serato: path assoluti. Alla ricollocazione bisogna riscrivere la base-path, ricodificare l'URL-encoding e gestire lettere di drive Windows vs nomi volume macOS.",
          "REKORDBOX 6+ LOCKDOWN: master.db cifrato (SQLCipher); scrittura diretta rischiosa e per MP3 VBR l'offset InMpegAbs/InMpegFrame resta irrisolto (pyrekordbox) -> preferire SEMPRE l'import via rekordbox.xml.",
          "PERDITE NOTE: colori cue persi verso Traktor; track color perso verso Engine DJ (Engine non supporta i track color, secondo il manuale Lexicon); FLIP Serato e remix set/Stems Traktor non portabili; last played non memorizzato da rekordbox; album art talvolta da re-importare manualmente (Engine).",
          "OFFSET MP3: silenzio aggiunto all'inizio di alcuni MP3 sposta cue/grid; applicare correzione (~26 ms in dj-data-converter) o riscansione automatica (Lexicon).",
          "REGRESSIONE REALE DA CITARE: Engine DJ 4.0.0 aveva un bug che metteva TUTTI gli hotcue importati da Traktor all'inizio della traccia (segnalazione community.enginedj.com) - esempio concreto di come un aggiornamento possa rompere la conversione.",
          "BEST PRACTICE OPERATIVE: fare backup SIA del DB DJ SIA dei file audio prima di convertire; trattare la conversione come operazione one-off (non workflow quotidiano); documentare ogni passaggio; verificare a campione allineamento grid e mapping cue dopo la conversione.",
          "CLAIM NON VERIFICATI: 'DJCU market leader / v7.58 Apr 2026' e una dichiarazione del venditore; 'rekordbox importa max 8 hotcue' proviene solo dal manuale Lexicon; la resa colore Serato differisce leggermente dai valori RGB grezzi (trasformazione interna, nota Holzhaus)."
        ],
        "sources": [
          "https://www.lexicondj.com/manual/convert-library",
          "https://www.lexicondj.com/convert-to-rekordbox",
          "https://www.mixo.dj/guides/dj-conversion-software",
          "https://www.digitaldjtips.com/3-ways-to-convert-your-dj-library-between-platforms/",
          "https://www.digitaldjtips.com/rekordcloud-mixo-apps-offer-new-dj-library-conversion-tools/",
          "https://github.com/digital-dj-tools/dj-data-converter/blob/master/README.md",
          "https://github.com/mixxxdj/mixxx/wiki/Serato-Metadata-Format",
          "https://github.com/Holzhaus/serato-tags",
          "https://homepage.ruhr-uni-bochum.de/jan.holthuis/reversing-seratos-geob-tags.html",
          "https://github.com/wolkenarchitekt/traktor-nml-utils/blob/master/tests/fixtures/collection.nml",
          "https://github.com/mixxxdj/mixxx/wiki/Engine-Library-Format",
          "https://raw.githubusercontent.com/ErikMinekus/traktor-scripts/master/rekordbox-export.py",
          "https://github.com/dylanljones/pyrekordbox/discussions/113",
          "https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf",
          "https://mixedinkey.com/camelot-wheel/",
          "https://www.mixgraph.io/tools/key-converter",
          "https://djcuebridge.com/",
          "https://support.enginedj.com/en/support/solutions/articles/69000834165",
          "https://community.enginedj.com/t/bug-engine-dj-4-0-0-puts-all-traktor-hotcues-at-the-beginning-of-the-track/57113",
          "https://atgr-production-team.sellfy.store/p/emuy/"
        ]
      }
    ]
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Map code"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Research formats"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Synthesize"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "map:core",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "a405799406900a01b",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156424,
      "lastProgressAt": 1783981156424,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"CORE di CrateForge — livello dominio puro (senza dipendenze Electron/UI): schema e accesso al database UDM (Universal Data Model, SQLite via better-sqlite3), conversione tonalità→Camelot, analisi armonica per il Set Planner, pagella \\\"salute libreria\\\" e estrazione etichette versione. Modello dati UDM (v4): meta (versioning schema), tracks (hub universale dei brani, UNIQUE(source,sou…",
      "promptPreview": "Leggi e mappa il sottosistema CORE di CrateForge in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/core (schema.ts, udm.ts, camelot.ts, harmony.ts, health.ts, versionRegex.ts). Descrivi ruolo di ogni file, modello dati UDM (tabelle, ownership), punti di forza, problemi concreti (bug/edge case/tipi) con file:line, e migliorie mirate. Non riscrivere cod…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "map:adapters",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "aa5d739074a355163",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156424,
      "lastProgressAt": 1783981156424,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"Adapters DJ (crateforge/src/adapters): writer Rekordbox XML (collection/relocation/inbox/set), writer Traktor NML, writer VirtualDJ XML, reader Traktor NML / VirtualDJ XML / Engine DJ SQLite, stub Serato ed Engine writer. Hub dati = UDM SQLite (tracks/playlists/playlist_tracks/cues). STATO ATTUALE — Export: Rekordbox XML (metadati, hot cue max 8 con colore, memory cue senza colore, a…",
      "promptPreview": "Leggi e mappa gli ADAPTERS in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/adapters (common.ts, rekordbox/*, traktor/nmlWriter.ts, virtualdj/vdjWriter.ts, serato/*, engine/*). Sono i writer/reader verso i software DJ. Elenca cosa SCRIVE e cosa LEGGE oggi ogni adapter, quali campi mappa (cue/beatgrid/playlist/rating/color), cosa manca per la conversi…"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "map:services",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "a8a3b29fa41ef7968",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156425,
      "lastProgressAt": 1783981156425,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"crateforge/src/services — 11 servizi di dominio (backup incrementale, orfani, report Excel, relocator, auto-tagger, sync daemon, set planner, set builder, encoding, fsutil) usati dal main process Electron via src/main/ipc.ts sopra il DB UDM (better-sqlite3). Architettura coerente: master.db Rekordbox in sola lettura, scritture solo su UDM/XML, azioni distruttive gated (quarantena rev…",
      "promptPreview": "Leggi e mappa i SERVICES in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/services (backup, orphans, excel/reportGenerator+reportViewer, relocator, tagger/autoTagger, watcher/syncDaemon, planner/setPlanner, setbuilder/setBuilder, encoding, fsutil.ts). Ruolo, punti di forza, problemi (edge case, performance su 50k tracce, gestione errori) con file:lin…"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "map:main-ipc",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "a256324d24a7f8866",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156425,
      "lastProgressAt": 1783981156425,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"CrateForge Electron MAIN process (IPC registration, write gates, progress throttling, Python sidecar lifecycle) + preload contextBridge\",\"files\":[{\"path\":\"C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main/index.ts\",\"role\":\"Bootstrap app: crea BrowserWindow, apre UDM sqlite in userData, chiama registerIpc; windowOpenHandler -> shell.ope…",
      "promptPreview": "Leggi e mappa il processo MAIN di CrateForge in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/main (index.ts, ipc.ts, sidecar.ts, progress.ts) e C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/preload (index.ts, api.d.ts). Copri: registrazione IPC, gate delle scritture, throttling progressi, spawn/gestion…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "map:renderer",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "a65d53e9643b531a6",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156425,
      "lastProgressAt": 1783981156425,
      "cached": true,
      "resultPreview": "{\"files\":[{\"path\":\"C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/App.tsx\",\"role\":\"Shell app: routing a stato (useState<PageId>), sidebar 18 voci, 8 expertOnly nascoste in modalità Semplice, fallback a dashboard\"},{\"path\":\"C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src/lib/appSta…",
      "promptPreview": "Leggi e mappa il RENDERER React in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/src/renderer/src (App.tsx routing+nav, pages/*, components/*, lib/i18n.ts+i18nPages.ts+appState.tsx). Valuta soprattutto INTUITIVITA UX/UI: coerenza, wizard, stati vuoti, feedback, accessibilita, onboarding, scoperta funzioni Esperto. Elenca problemi UX concreti per pagina e…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "map:sidecar",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "acd50b56275f18346",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156425,
      "lastProgressAt": 1783981156425,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"CrateForge Python sidecar (pyrekordbox + fpcalc + mutagen). Contratto con Node (src/main/sidecar.ts): spawn `sidecar <comando> --udm-path <file>`, stdout SOLO righe JSON {type: progress|done|error|log}; dati di massa scritti direttamente nell'UDM SQLite (schema di proprietà Node, versione 4, niente DDL lato Python). Comandi: ping (smoke test, emette pong+versione Python); ingest-mast…",
      "promptPreview": "Leggi e mappa il sidecar Python in C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/python-sidecar/sidecar.py (e requirements.txt, build_sidecar.*). Elenca i comandi, come apre/scrive master.db (pyrekordbox), fingerprint, write-tags, masterdb-create-playlist, gestione errori/handshake UDM. Problemi con riga, e migliorie (robustezza, comandi mancanti per imp…"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "map:tests-build",
      "phaseIndex": 1,
      "phaseTitle": "Map code",
      "agentId": "a7c25abfd0e9ce0a1",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981156426,
      "lastProgressAt": 1783981156426,
      "cached": true,
      "resultPreview": "{\"subsystem\":\"CrateForge — suite di test (Vitest via Electron-as-Node) e pipeline di build/packaging (electron-vite + electron-builder + GitHub Actions + sidecar PyInstaller)\",\"files\":[{\"path\":\"C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/package.json\",\"role\":\"Script npm (test/build/dist/typecheck/rebuild), dipendenze pinnate esatte, postinstall install…",
      "promptPreview": "Leggi e mappa TEST e BUILD di CrateForge: C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/tests/*, C:/Users/Vale/Desktop/Claude-Projects/TrackList-Tool-2025-MacOS/TrackList-Tool/crateforge/package.json, electron-builder.yml, electron.vite.config.ts, tsconfig*.json, .github/workflows/build.yml, scripts/run-vitest.cjs. Copertura test attuale (cosa e testato,…"
    },
    {
      "type": "workflow_agent",
      "index": 8,
      "label": "research:rekordbox",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "ab1232ff3a49c691b",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981158115,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Rekordbox (Pioneer DJ / AlphaTheta), famiglia rekordbox 5/6…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. Rekordbox: formato XML \"DJ_PLAYLISTS\" (rekordbox.xml) e database master.db (rekordbox 6/7). Come sono rappresentati POSITION_MARK (hot/memory cue), TEMPO (beatgrid), Tonality/Key, Rating, Colour, playlist gerarchiche. Limiti dell'import XML (8 hot cue, memory cue color, MyTag, loop). Librerie: pyrekordbox. Cita fonti. Restituisci fatti tecnici concre…",
      "lastProgressAt": 1783981585281,
      "tokens": 68761,
      "toolCalls": 22,
      "durationMs": 427165,
      "resultPreview": "{\"app\":\"Rekordbox (Pioneer DJ / AlphaTheta), famiglia rekordbox 5/6/7. Due formati rilevanti: (1) export/import XML \\\"DJ_PLAYLISTS\\\" (rekordbox.xml), formato di interscambio pubblico e documentato ufficialmente da Pioneer; (2) database collection interno master.db, introdotto con rekordbox 6 e usato anche da rekordbox 7. Tutti i fatti sotto sono verificati sulla spec ufficiale Pioneer + docs pyrek…"
    },
    {
      "type": "workflow_agent",
      "index": 9,
      "label": "research:traktor",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "adab1280ab3383745",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981159850,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Native Instruments Traktor Pro (2.x / 3.x / 4.x). Il file d…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. Native Instruments Traktor Pro: formato collection.nml (NML XML). Come rappresenta CUE_V2 (hot cue, load, grid, loop, fade), TEMPO/beatgrid (BPM + gridmarker), MUSICAL_KEY, RANKING (rating), playlist e folder. Dove sta il file (Documents/Native Instruments/Traktor). Librerie open source per leggere/scrivere NML. Gotchas su import/export. Cita fonti. …",
      "lastProgressAt": 1783981452969,
      "tokens": 64944,
      "toolCalls": 23,
      "durationMs": 293119,
      "resultPreview": "{\"app\":\"Native Instruments Traktor Pro (2.x / 3.x / 4.x). Il file di libreria e' la \\\"Track Collection\\\" in formato NML.\",\"formatType\":\"NML = file XML in chiaro, UTF-8. Header: <?xml version=\\\"1.0\\\" encoding=\\\"UTF-8\\\" standalone=\\\"no\\\"?> poi <NML VERSION=\\\"19\\\"> (l'attributo VERSION cambia con la major: ~19 per TP3). Struttura: <NML> > <HEAD COMPANY=\\\"www.native-instruments.com\\\" PROGRAM=\\\"Traktor…"
    },
    {
      "type": "workflow_agent",
      "index": 10,
      "label": "research:serato",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "aaabc0ed2cc34673c",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981158495,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Serato DJ Pro / Serato DJ Lite (ex ScratchLive). La libreri…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. Serato DJ: come memorizza la libreria. Crates (.crate binari in _Serato_/Subcrates), database V2, e i metadati per-file nei tag ID3/GEOB (\"Serato Markers2\", \"Serato BeatGrid\", \"Serato Overview\"). Come sono codificati hot cue, loop, beatgrid, color. Librerie open source: seratopy, pyserato, serato-tags. Fattibilita lettura E scrittura. Cita fonti. Res…",
      "lastProgressAt": 1783981391083,
      "tokens": 55138,
      "toolCalls": 16,
      "durationMs": 232587,
      "resultPreview": "{\"app\":\"Serato DJ Pro / Serato DJ Lite (ex ScratchLive). La libreria e memorizzata in DUE posti complementari: (1) file di database e crate nella cartella _Serato_, e (2) metadati per-traccia scritti direttamente dentro i file audio come tag GEOB/ID3 (o equivalenti MP4/FLAC/Ogg). Serato scrive i dati in entrambi: il database e un indice/cache, ma la verita analitica (cue, beatgrid, overview) vive …"
    },
    {
      "type": "workflow_agent",
      "index": 11,
      "label": "research:engine",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "a7db32dd15ab17658",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981158181,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Engine DJ (Denon DJ / Engine Prime desktop / Engine OS su h…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. Engine DJ (Denon/Engine Prime/Engine OS): Engine Library, database SQLite (m.db, Database2/m.db, hm.db). Schema tabelle Track, PerformanceData/beatgrid/cue/loop, Playlist/PlaylistEntity. Come sono codificati cue e beatgrid (spesso blob/JSON). Librerie open source per leggere/scrivere Engine Library. Rischi versione-schema. Cita fonti. Restituisci fat…",
      "lastProgressAt": 1783981519193,
      "tokens": 70840,
      "toolCalls": 23,
      "durationMs": 361012,
      "resultPreview": "{\"app\":\"Engine DJ (Denon DJ / Engine Prime desktop / Engine OS su hardware SC5000/SC6000/Prime, Numark Mixstream). Stesso Engine Library condiviso tra desktop e player standalone.\",\"formatType\":\"Database SQLite (file .db). Colonne performance in BLOB binari zlib+qCompress (loops NON compresso). Verificato: fatti da documentazione/sorgenti, NON ho aperto un DB reale in questo progetto.\",\"location\":…"
    },
    {
      "type": "workflow_agent",
      "index": 12,
      "label": "research:virtualdj",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "a4e7c647969ebf83b",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981158711,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "VirtualDJ (versioni 8 / 2021 / 2023 / 2024 / 2026: stessa s…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. VirtualDJ: file database.xml (Documents/VirtualDJ/database.xml), struttura Song/Infos/Tags/Poi (cue points, loops, beatgrid via \"AudioBpm\"/\"beatgrid\"). Come sono rappresentati POI (cue/loop), key, rating. Librerie/parser. Fattibilita read/write. Cita fonti. Restituisci fatti tecnici concreti e verificati, con URL delle fonti. Se un'informazione non e…",
      "lastProgressAt": 1783981633788,
      "tokens": 71085,
      "toolCalls": 25,
      "durationMs": 475075,
      "resultPreview": "{\"app\":\"VirtualDJ (versioni 8 / 2021 / 2023 / 2024 / 2026: stessa struttura DB di base, con evoluzioni sul beatgrid). Fatti verificati su VDJPedia e forum ufficiali VirtualDJ + wiki Mixxx.\",\"formatType\":\"Un unico file XML di testo, database.xml, codifica UTF-8 (dal v6.0). Radice: elemento VirtualDJ_Database con attributo Version (es. Version='8.1'). Contiene una sequenza di elementi Song, ognuno c…"
    },
    {
      "type": "workflow_agent",
      "index": 13,
      "label": "research:conversion-landscape",
      "phaseIndex": 2,
      "phaseTitle": "Research formats",
      "agentId": "ad9100bd2604db42c",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981158537,
      "queuedAt": 1783981156460,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Panorama tool di conversione librerie DJ 2024-2025. Princip…",
      "promptPreview": "Usa WebSearch e WebFetch per ricercare a fondo. Panorama tool di conversione librerie DJ nel 2024-2025: Lexicon DJ, MIXO/rekordcloud, DJ Conversion Utility, rekordbox<->serato<->traktor<->engine. Quali conversioni sono considerate affidabili, quali perdono dati (cue, beatgrid, playlist), best practice per una conversione bidirezionale (modello dati universale intermedio, normalizzazione key Camelo…",
      "lastProgressAt": 1783981489599,
      "tokens": 65955,
      "toolCalls": 23,
      "durationMs": 331062,
      "resultPreview": "{\"app\":\"Panorama tool di conversione librerie DJ 2024-2025. Principali: (1) Lexicon DJ — app desktop Win/Mac, hub piu completo, conversione gratuita, gestione libreria + sync; supporta rekordbox, Serato, Traktor, Engine DJ, VirtualDJ, djay Pro. (2) MIXO (ex-website \\\"The DJ Library\\\") — libreria cloud + conversione, abbonamento (~7$/mese), ancora in beta, supporto rekordbox 6 export storicamente l…"
    },
    {
      "type": "workflow_agent",
      "index": 14,
      "label": "synthesize-plan",
      "phaseIndex": 3,
      "phaseTitle": "Synthesize",
      "agentId": "abcf73d8ee993f063",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1783981642626,
      "queuedAt": 1783981635449,
      "attempt": 1,
      "promptPreview": "Sei l'architetto di CrateForge (Electron+TS+React, UDM SQLite, sidecar Python; import oggi solo da Rekordbox master.db/XML; export verso Rekordbox XML, Traktor NML, VirtualDJ XML; Serato/Engine sono stub \"in arrivo\"; scrittura diretta master.db via pyrekordbox appena aggiunta).\n\nTi do (1) la mappa del codice con problemi e migliorie, (2) la ricerca sui formati delle librerie DJ e sui tool di conve…",
      "lastProgressAt": 1783981781609,
      "tokens": 140325,
      "toolCalls": 0,
      "durationMs": 138983,
      "resultPreview": "# PIANO OPERATIVO CrateForge\n\n## 1. TOP FIX DEL CODICE (max 10, per impatto)\n\n1. **NFC/NFD su macOS — falsi orfani e relocate mancati** — `services/orphans/orphanFinder.ts:27` + `services/relocator/relocator.ts:57` + `services/watcher/syncDaemon.ts:134`. `canon()` non normalizza Unicode: ogni traccia con accenti (Beyoncé, Über) diventa falso orfano e, combinata con quarantena/delete, l'utente canc…"
    }
  ],
  "totalTokens": 537048,
  "totalToolCalls": 132
}