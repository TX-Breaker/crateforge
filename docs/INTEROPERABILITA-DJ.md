# Interoperabilità tra software DJ e conversione bidirezionale in CrateForge

**Rekordbox · Serato · Traktor · VirtualDJ · Engine DJ**
Report tecnico — 2026-07-14

---

## 1. Executive summary

CrateForge è un convertitore basato su un **modello-pivot** (UDM: `NormTrack` / `NormCue`, con tabella `cues(cue_type, cue_index, position_ms REAL, length_ms REAL, color, label)`). Il pivot memorizza ogni cue in **millisecondi assoluti** con tre tipi (`hot` / `memory` / `loop`), indice pad, colore RGB esadecimale e label. Lo schema è già adeguato: il collo di bottiglia **non è il modello dati, sono le implementazioni degli adapter**.

**Cosa si converte bene (lossless o perdita ≤ 1 ms):**
- Metadati base: titolo, artista, album, genere, anno, BPM, key/Camelot, durata, path, filesize.
- Asse **temporale** dei cue tra formati basati su ms interi/float (Serato ↔ Traktor ↔ Rekordbox-DB), tenendo il pivot in `REAL`.
- Colore **RGB ↔ RGB** (Serato ↔ XML Rekordbox ↔ Engine).
- Hot cue entro gli 8 slot, tra software con almeno 8 pad.
- Label/nome del cue (stringa).
- Playlist statiche (albero) da Rekordbox-DB, Traktor, Engine.

**Cosa si perde oggi (silenziosamente):**
- **TUTTI i cue nell'import diretto da Rekordbox master.db**: il sidecar `cmd_ingest_masterdb` non interroga affatto `DjmdCue`.
- **TUTTI i cue Serato** (adapter stub `available:false`) e **tutti i cue Engine** (blob `PerformanceData` non decodificato).
- **Loop verso Rekordbox**: `xmlWriter.ts` esclude esplicitamente i loop.
- **Colori dei cue** in ogni rotta che tocca Traktor (nessun RGB sorgente) e nel path master.db (manca la mappa indice-palette → RGB).
- **Gain, rating, track-color, beatgrid reale (fase)**: mai trasportati — limite dell'UDM, non dei formati.
- **Smart/intelligent list**: sempre materializzate come playlist statiche o ignorate (criteri persi).
- **Playlist VirtualDJ**: nessun parsing dei `.vdjfolder`.

**Dove CrateForge è già avanti:**
- Pivot solido e già capace di rappresentare hot/memory/loop con precisione `REAL`.
- Traktor e VirtualDJ leggono **e** scrivono.
- Rekordbox: reader master.db (metadati + playlist), reader **e** writer Collection XML.
- Reader XML già gestisce correttamente hot (`Num≥0`), memory (`Num<0`), loop (`End`) e colori RGB.
- `incrementalBackup.ts` (snapshot DB + copia verificata a hash) è scritto e funzionante.

**Dove è indietro:**
- Reader Serato ed Engine-cue assenti; writer Serato ed Engine assenti.
- Nessuna mappa colore indice ↔ RGB.
- Backup **non agganciato** al flusso di conversione.
- Bug di portabilità confermati sui volumi non-boot Traktor.
- Beatgrid sempre sintetica a BPM costante.

**Priorità #1 assoluta:** leggere `DjmdCue` dal master.db. È un fix a basso costo (pyrekordbox li espone già) e altissimo valore: elimina la perdita più grave e silenziosa dell'intera pipeline.

---

## 2. Analisi per software

### 2.1 Rekordbox 7.2.14 (Pioneer / AlphaTheta)

Libreria reale ispezionata: `/Users/dj-john/Library/Pioneer/rekordbox/` — 6102 brani (`DjmdContent`), 3368 cue (`DjmdCue`), 158 playlist.

#### Libreria / storage
DB primario **cifrato SQLCipher**: `master.db` (~300 MB). L'header **non** è `SQLite format 3` (primi byte `77 82 f1 a3 f1 52 9b a0…`) → confermato cifrato; pyrekordbox 0.4.3 lo apre con la chiave **DB6** in cache. Schema con tabelle `Djmd*` normalizzate via FK (`ArtistID→DjmdArtist.Name`, `KeyID→DjmdKey.ScaleName`, `ColorID→DjmdColor`, `AlbumID/GenreID/LabelID`).

- `DjmdContent.BPM` = **intero × 100** (verificato: raw `10527` → 105.27 BPM).
- `Length` in secondi; `FolderPath` = path assoluto del file.
- Ogni riga ha campi di sync cloud (`usn`, `rb_local_usn`, `UUID`, `rb_data_status`).
- L'analisi audio (beatgrid, waveform, cue di dettaglio con RGB/commento) **non** sta nel DB ma nei file **ANLZ** binari in `share/PIONEER/USBANLZ/<hash>/ANLZ0000.DAT/.EXT/.2EX/.3EX` (path relativo in `DjmdContent.AnalysisDataPath`).
- `networkAnalyze6.db` in chiaro (cache); `product.db` non è un DB SQLite valido; `masterPlaylists6.xml`/`automixPlaylist6.xml` sono indici XML in chiaro (solo `Id/ParentId/Timestamp/Attribute`, **non** i brani).
- Canale interop ufficiale separato: **EXPORT "rekordbox collection XML"** (radice `DJ_PLAYLISTS`), generato a mano dall'utente.

#### Playlist / crate
`DjmdPlaylist` (albero) + `DjmdSongPlaylist` (membership: `PlaylistID/ContentID/TrackNo`). `DjmdPlaylist.Attribute` distingue il tipo:

| Attribute | Tipo | Conteggio reale |
|---|---|---|
| 0 | playlist normale | 136 |
| 1 | folder/cartella | 18 |
| 4 | smart/intelligente | 4 |

Gerarchia via `ParentID`, ordinamento via `Seq`. Le smart list conservano i criteri in una colonna `SmartList` XML (`LogicalOperator`, `AutomaticUpdate`, condizioni) — es. playlist reali `Doublons`, `A SUPPRIMER`. L'adapter (sidecar `_ingest_playlists`) mappa **solo** `Attribute==1 → is_folder`, tutto il resto (incluso 4=smart) → playlist normale: **le smart list vengono materializzate come statiche, perdendo i criteri**. Esistono anche `DjmdHotCueBanklist` e `DjmdSampler`, non gestiti.

#### Backup
Backup **rotanti automatici** accanto all'originale: `master.backup.db`, `master.backup2.db`, `master.backup3.db` (~46 MB ciascuno, compattati). Sono copie **cifrate** SQLCipher con la stessa chiave (header non-SQLite: `16 7c 6f 3b 81 c3…`; `sqlite3` diretto → `file is not a database`). In più un "Library backup" manuale/on-quit verso zip (in Preferenze). **CrateForge non crea né gestisce backup del master.db**: lavora sempre in sola lettura (o su copia) e non scrive mai cue/brani nel master.db.

> Nota sicurezza: prima di aperture concorrenti conviene **copiare** (come fatto qui in `/tmp`) perché rekordbox risultava in esecuzione (warning pyrekordbox "Rekordbox is running").

#### Cartelle musica & path
`DjmdContent.FolderPath` = path **assoluto** (es. `/Users/dj-john/Music/NEW PLAYLIST 2025/70/70 - 80 Discoteca/Imagination - Just An Illusion (Satin Jackets Rework).mp3`). Esistono `FileNameL/FileNameS`, `OrgFolderPath`, `rb_LocalFolderPath`. **Niente path relativi**: spostare i file o cambiare drive rompe il collegamento (brano "mancante", va rilocato). L'export XML (`pathToLocation`) genera URI `file://localhost/…` e preserva la lettera di drive Windows senza percent-encoding. La rilocazione CrateForge **non tocca** il master.db: la Fase 2 (`relocation_matches`, fingerprint via fpcalc/Chromaprint) produce un XML che l'utente reimporta a mano.

#### Hot cue & loop
Hot cue, memory cue e loop sono **tutti righe di `DjmdCue`** (una riga per cue), collegate al brano via `ContentID`. **Non** nei tag audio: verificato con mutagen su un mp3 reale, che ha solo frame ID3 standard (`TDRC, TPE1, TIT2, TCON, TKEY, COMM, APIC`) e **zero** frame GEOB/Serato/POI.

**Tipo:**
- `Kind=0` = memory cue.
- `Kind≥1` = hot cue / loop.
- Loop = qualsiasi cue con `OutMsec != -1`.

> ⚠️ **CORREZIONE (verifica avversariale) — `Kind` NON è il numero di slot del pad.** I brani con tutti gli 8 pad occupati usano **sempre** l'insieme `Kind {1,2,3,5,6,7,8,9}` (16/16 brani, zero eccezioni), **non** `1-8` contiguo. `Kind=4` è **saltato sistematicamente**: le uniche 3 righe con `Kind=4` sono **loop attivi** (`OutMsec` e `BeatLoopSize` valorizzati). La mappatura pad → Kind è **non-contigua**: pad 1-3 → Kind 1,2,3; pad 4-8 → Kind 5,6,7,8,9 (offset +1, con 4 riservato ai loop). `Kind` è un **indice ordinale monotòno**, non lo slot letterale.
>
> Distribuzione reale `Kind` su 3368 righe: `{0:1137, 1:494, 2:414, 3:321, 4:3, 5:226, 6:111, 7:38, 8:316, 9:303, 10:1, 11:1, 12:1, 13:1, 14:1}`.
>
> `Kind 10-14` (5 righe, tutte su `ContentID 81306982`) hanno `Comment='CUE(Auto)'` = cue auto-rilevati oltre gli 8 pad. Quindi `Kind≥1` **non** è esclusivamente hot-cue-utente.
>
> La docstring pyrekordbox su `Kind` ("Cue=0, Load=3, Loop=4") è **imprecisa**.

**Unità:**
- `DjmdCue.InMsec` = **millisecondi interi** (In point).
- `InFrame` = frame a **150 fps** (1 frame = 1000/150 = 6.6667 ms).

> ⚠️ **CORREZIONE (verifica avversariale) — la conversione è TRONCAMENTO (floor), non round.** Formula esatta, verificata con **0 discrepanze su tutte le 3368 righe reali**:
>
> ```
> InFrame = (InMsec * 150) // 1000  ==  floor(InMsec * 0.15)
> ```
>
> La formula `round(InMsec*0.15)` produce **1578 errori su 3368 righe (47%)**. Controesempio dal DB reale: `InMsec=294690` → `294690*0.15 = 44203.5` → `floor = 44203` (= valore reale nel DB), mentre `round = 44204`. Altri: `56919→8537` (non 8538), `39271→5890` (non 5891). I casi con parte frazionaria `.1` (`55634→8345`, `73274→10991`) non distinguono le due formule; solo il caso `.5` espone la differenza.

- `OutMsec`/`OutFrame` per il punto di uscita del loop (stessa unità). Lunghezza loop = `OutMsec - InMsec` (diretta).
- L'export XML usa invece **secondi a 3 decimali** (`POSITION_MARK Start/End`) → risoluzione pratica = 1 ms.

**Colori:**
`DjmdCue.Color` = **indice intero di palette** (NON RGB), `-1` = default. Valori distinti nel DB: `[-1, 1, 2, 4, 255]` (coerente con enum, incompatibile con RGB a 24 bit). Distribuzione: `-1 ×3344, 255 ×20, 4 ×2, 1 ×1, 2 ×1`.

> ⚠️ **CORREZIONE (verifica avversariale) — `ColorTableIndex` NON è sempre None.** 25 cue su 3368 hanno `ColorTableIndex` non nullo. Distribuzione: `None=3343, 0=20, 45=2, 22=1, 62=1, 56=1`. `Color` e `ColorTableIndex` sono parzialmente indipendenti (es. cue `682839998`: `Color=-1` ma `ColorTableIndex=22`; le cue con `Color=255` hanno `ColorTableIndex=0`).

Gli RGB veri vivono in ANLZ `PCO2` e nell'export XML (`Red/Green/Blue`). L'adapter lavora in hex `#rrggbb`, li legge **solo** dall'XML e li riscrive come `Red/Green/Blue` solo per gli hot cue.

**Limiti:** Rekordbox 7 supporta **più di 8 hot cue**: un brano reale (`ContentID 81306982`) ha 11 hot cue negli slot `[1,2,3,5,6,9,10,11,12,13,14]` (max slot osservato = 14 → fino a 16 via banchi). Il limite di 8 **non è di rekordbox** ma dell'XML e dell'adapter → gli slot 9-16 vengono **persi** in export/roundtrip XML.

**Esempio reale** — *Just An Illusion (Satin Jackets Rework)* — Imagination (`ContentID 158003531`), 7 righe `DjmdCue`:

| Kind | In (ms) | InFrame | Out | Color | Tipo |
|---|---|---|---|---|---|
| 0 | 334 | 50 | -1 | -1 | memory |
| 0 | 40997 | | -1 | -1 | memory |
| 1 | 40997 | | -1 | -1 | hot (pad 1) |
| 2 | 90808 | | -1 | -1 | hot (pad 2) |
| 3 | 199487 | | -1 | -1 | hot (pad 3) |
| 8 | 290053 | | -1 | -1 | hot (pad ~7) |
| 9 | 439487 | | -1 | -1 | hot (pad ~8) |

Cue etichettato: `ContentID 98239311` memory `In=56919ms Comment='Vocal'`. Loop reale: `ContentID 54659340` memory loop `In=200527ms Out=204527ms` (durata 4000 ms = 8 beat) `BeatLoopSize=524289`.

#### Altri metadati
BPM intero ×100; Key via `KeyID→DjmdKey.ScaleName` (adapter → Camelot). Beatgrid **non nel DB**, sta in ANLZ `PQTZ` → l'export CrateForge sintetizza una griglia a BPM costante da 0. Waveform in ANLZ `PWAV/PWV2`. Rating in `DjmdContent.Rating`. Gain in `DjmdMixerParam`. Track color via `ColorID→DjmdColor` (8 colori: 1=Pink,2=Red,3=Orange,4=Yellow,5=Green,6=Aqua,7=Blue,8=Purple). MyTag in `DjmdMyTag/DjmdSongMyTag`. Play count in `DJPlayCount`. ISRC/Label/Composer/Remixer/Lyricist in `DjmdContent`. Cronologia in `DjmdHistory/DjmdSongHistory` (letta dal sidecar `read-history` per il report SIAE). **Il sidecar `ingest-masterdb` estrae solo: title, artist, album, genre, year, bpm, key/camelot, duration, path, filesize, version_label.**

> Nota ANLZ (verifica avversariale): i tag **PCO2 SONO parsabili** da pyrekordbox 0.4.3 (parse OK su `.EXT` reale). Il ~34% dei file `.EXT` (1983/5823) che sollevano `ConstError` fallisce **a causa del tag PQT2**, non di PCO2: rekordbox 7 scrive `PQT2.u1 = 0x02000002` mentre pyrekordbox (`structs.py:170`) lo hardcoda `Const(0x01000002)` → mismatch (atteso 16777218, letto 33554434). I file col vecchio valore `0x01000002` (3672) parsano completamente. Tutti i `PCOB` (.DAT, 6048 file) e tutti i `PCO2` (.EXT, 5823 file) hanno **count=0**: le cue vivono solo in `DjmdCue`.

#### Stato adapter CrateForge
Path: `src/adapters/rekordbox/` (**solo writer**: `xmlWriter.ts`, `inboxXml.ts`, `relocationXml.ts`, `setXml.ts`). Lettura in `python-sidecar/sidecar.py` (`cmd_ingest_masterdb`, `cmd_read_history`, `cmd_masterdb_create_playlist`) e `src/core/xmlCollection.ts`.

- **Legge master.db** (`cmd_ingest_masterdb`): `DjmdContent` (metadati base) + `DjmdPlaylist/DjmdSongPlaylist` (albero, `Attribute→folder`). **NON legge `DjmdCue`.**
- **Legge XML** (`xmlCollection.ts`): `COLLECTION/TRACK` + `POSITION_MARK` (hot `Num≥0`, memory `Num<0`, loop `End→length_ms`) + colori RGB + albero playlist.
- **Scrive XML** (`xmlWriter.ts`): `DJ_PLAYLISTS` con `TRACK`, `TEMPO` (griglia BPM-costante sintetica), `POSITION_MARK` per hot (cap 8, con `Red/Green/Blue`) e memory (`Num=-1`, senza colore), albero `NODE`. **Loop esclusi.**
- **Scrittura diretta playlist** nel master.db via `cmd_masterdb_create_playlist` (modalità Esperto).

**PRO:** unico software con reader DB + reader/writer XML; XML è la lingua franca ingeribile da Serato/Engine/VirtualDJ.
**CONTRO (mancante):** (1) **cue mai letti dal DB** → import nativo = 0 cue; (2) nessuna mappa indice-colore → RGB; (3) cap 8, slot 9-16 persi; (4) off-by-one `Kind`(1-based DB)/`Num`(0-based XML) non gestito; (5) writer non emette loop; (6) beatgrid reale, waveform, rating, track-color, gain, MyTag, DJPlayCount, ISRC, `DjmdHotCueBanklist`, smart list, sampler non gestiti.

---

### 2.2 Serato DJ Pro

Libreria: `/Users/dj-john/Music/_Serato_/` con `database V2` (1970 byte, 2 brani). `Subcrates/` e `SmartCrates/` **vuote**. Seconda libreria su `/Volumes/DISCO-C/_Serato_/Library` (permessi 700, vuota). **Punto chiave: le cue reali NON stanno nelle librerie ma nei tag ID3 dei file audio** — 96 file `.mp3` sotto `/Users/dj-john/Music/` contengono il frame GEOB `Serato Markers2`.

#### Libreria / storage
`database V2` = binario a **chunk**. Header: magic ASCII `vrsn` (4 byte) + uint32 BE length + stringa UTF-16BE `2.0/Serato Scratch LIVE Database`. Ogni brano = chunk `otrk` `[tag 4-char ASCII + uint32 BE length + body]`. Convenzione sul 1° carattere del tag:

| Prefisso | Tipo | Esempi |
|---|---|---|
| `t*` | stringa UTF-16BE | `tsng`, `tart`, `talb`, `tgen`, `tbpm`='126.00', `tkey`='Am', `tlen`='02:51.49' |
| `p*` | path UTF-16BE | `pfil` |
| `u*` | uint32 BE | `uadd`, `utme`, `ufsb` (filesize), `utkn` (track#) |
| `b*` | bool 1 byte | `bply`, `blop`, `bbgl`, `bmis` |

Prova reale: 2 chunk `otrk`; `pfil='Users/dj-john/Music/Music/Media.localized/Music/Various Artists/Funk & Disco - Everybody Loves/03 All Night (Radio Mix).mp3'`, `tbpm='126.00'`, `tkey='Am'`, `ufsb=7118055`, `uadd=1776456240`. **Il database NON contiene nessun dato di cue/loop/beatgrid.** I `.crate` usano lo stesso formato (`vrsn` + `otrk` con `ptrk` = path, colonne `ovct`/`tvcn`, sort `osrt`).

#### Playlist / crate
Ogni crate = un file `.crate` separato in `Subcrates/`. Gerarchie via separatore `%%` nel **nome** del file (`Estate%%House.crate` = crate "House" dentro cartella "Estate"). `SmartCrates/` contiene gli smart crate (`.scrate`). **Nessun file-indice unico**: la lista si ricava enumerando i file.

> ⚠️ In questo Mac `Subcrates/` e `SmartCrates/` sono **vuote**: struttura `.crate`/`.scrate` e gerarchia `%%` descritte da conoscenza del formato, **non** verificate su file reali.

#### Backup
`_Serato_/Export Backups/backup-YYYYMMDD_HHMMSS+ZZZZ.zip`, ciascuno contenente **unicamente** una copia del `database V2` (verificato `unzip -l`: da 72 a 1970 byte). 6 backup presenti (2026-04-18 → 2026-07-14). **Il backup salva SOLO il database, NON i crate né i tag ID3 con le cue** → affidarsi ad esso per proteggere le cue è **errato**.

#### Cartelle musica & path
`pfil` (database) / `ptrk` (crate) = path **senza slash iniziale**, relativo alla **radice del volume** su cui sta la cartella `_Serato_`. Esempio: `Users/dj-john/Music/…/03 All Night (Radio Mix).mp3` (il file reale è a `/Users/dj-john/Music/…`). Questo rende la libreria **portabile** tra drive: su un drive esterno i path sono relativi alla radice di quel volume. **È l'unico software progettato per la portabilità drive-to-drive.**

#### Hot cue & loop
**Nel file audio** (tag ID3 GEOB `Serato Markers2`). Struttura: 2 byte versione `0x01 0x01` + payload **base64** (newline ogni ~72 char, terminatore null). Decodificato: header `0x01 0x01` + sequenza di entry `[nome ASCII null-terminated ('CUE','LOOP','COLOR','BPMLOCK') + uint32 BE length + body]`. Body di una entry `CUE` (21 byte tipici): `byte0=0x00`, `byte1`=indice (0-7), `byte2-5`=**posizione uint32 BE in ms**, `byte6=0x00`, `byte7-9`=RGB, `byte10-11=0x00 0x00`, poi nome UTF-8 null-terminated. Esiste anche il frame legacy `Serato Markers_` (versione `0x0205`, ridondante).

**Unità:** **millisecondi interi, uint32 big-endian** (NON campioni/frame/secondi). Verificato: `idx1 = 0x00008c4f = 35919 ms`.

**Colori:** RGB 3 byte grezzi. Default Serato: `#cc0000, #cc8800, #0000cc, #cccc00, #00cc00, #cc00cc, #00cccc, #8800cc`. Track color in entry `COLOR` separata (`#ffffff` = nessuno).

**Tipi:** `CUE` (hot), `LOOP` (saved loop, start/end uint32 BE ms), `COLOR`, `BPMLOCK`. **Serato NON ha memory cue** alla Rekordbox.

**Limiti:** **max 8 hot cue** (indici 0-7). Verificato su 96 file, istogramma `{0:1, 3:2, 4:1, 5:8, 6:4, 7:5, 8:75}`. Anche i saved loop sono max 8.

**Esempio reale** — `Tones & I - Dance Monkey (Dunisco Remix).mp3`, GEOB `Serato Markers2` (470 byte), 8 hot cue:

| idx | pos (ms) | colore | nome |
|---|---|---|---|
| 0 | 31 | #cc0000 | Energy 6 |
| 1 | 35919 | #cc8800 | Energy 4 |
| 2 | 53863 | #0000cc | Energy 6 |
| 3 | 89751 | #cccc00 | Energy 7 |
| 4 | 125638 | #00cc00 | Energy 7 |
| 5 | 161526 | #cc00cc | Energy 7 |
| 6 | 179470 | #00cccc | Energy 4 |
| 7 | 197414 | #8800cc | Energy 7 |

`COLOR=#ffffff`, `BPMLOCK=00`. BeatGrid: 1 marker, 0.0209 s, 107.0 BPM.

> ⚠️ Nessun saved loop presente in tutta la libreria (0 entry LOOP su 96 file): struttura body LOOP **dedotta, non verificata**.

#### Altri metadati
BeatGrid (GEOB `Serato BeatGrid`): binario, versione `0x0100` + uint32 BE count + marker; posizione **float32 BE in SECONDI**, BPM float32 BE (verificato 0.0209 s, 107.0 BPM). Autotags (`Serato Autotags`): ASCII null-separato, `'107.00'` (BPM) / `'-3.436'` (auto-gain dB) / `'0.000'`. Waveform (`Serato Overview`): 3842 byte pre-renderizzati. Track color in `COLOR` (Markers2). Rating/gain: `bhrt`/flag + Autotags.

> Nota: alcuni file contengono GEOB **non-Serato** (`CuePoints` application/json, `Key`, `Energy`) scritti da tool di terze parti (probabile Mixed In Key), da non confondere.

#### Stato adapter CrateForge
Path: `src/adapters/serato/index.ts` (496 byte). Esporta **solo** `SERATO_STATUS = { available:false, reason:'Export diretto verso Serato in arrivo…' }`. UI marca `imp:'none' exp:'none'` con badge `comingSoon`.

- **Legge:** nulla. **Scrive:** nulla.
- Il pivot è **pronto**: `NormCue` e la tabella `cues` possono già rappresentare hot/memory/loop con `position_ms/length_ms/color/label`. Il writer Rekordbox legge già queste cue.

**PRO:** formato ben documentato; conversione unità triviale (ms uint32 → `position_ms` diretto; RGB → hex diretto).
**CONTRO (mancante):** tutto il lato Serato — (1) reader `database V2`; (2) reader `.crate`/`.scrate`; (3) reader GEOB (`Markers2`/`Markers_`/`BeatGrid`/`Autotags`/`Overview`); (4) writer (database + GEOB). **Rischio elevato:** scrivere le cue significa **mutare i tag ID3 dei file audio reali** → obbligo copie + backup dei file.

---

### 2.3 Traktor Pro 4 (v4.4.2)

Libreria: `/Users/dj-john/Documents/Native Instruments/Traktor 4.4.2/collection.nml` — XML `VERSION="20"`, `PROGRAM="Traktor Pro 4"`. 13 `ENTRY`, 119 `CUE_V2`, 7 nodi playlist (3 `SMARTLIST` + 4 liste). Tutti Factory Sounds.

#### Libreria / storage
Singolo file XML testuale `collection.nml` (**non** SQLite). Radice `NML VERSION="20"` con `HEAD`, `COLLECTION ENTRIES="13"`, `SETS`, `PLAYLISTS`. Ogni brano = `ENTRY` con figli: `LOCATION(DIR/FILE/VOLUME/VOLUMEID)`, `ALBUM`, `INFO(BITRATE, LABEL, KEY testuale es "Ebm", PLAYTIME sec, PLAYTIME_FLOAT, FILESIZE in KiB)`, `TEMPO(BPM float 6 decimali)`, `LOUDNESS(PEAK_DB/PERCEIVED_DB/ANALYZED_DB)`, `MUSICAL_KEY(VALUE 0-23)`, e N × `CUE_V2`. `AUDIO_ID` = fingerprint acustico base64. Traktor può mirrorare l'analisi in un frame ID3 `PRIV:TRAKTOR4` (~100 KB, marker `DMRT/RDH`/waveform), ma **CrateForge legge solo la NML**.

#### Playlist / crate
Albero sotto `PLAYLISTS` con `NODE` ricorsivi. Radice `NODE TYPE="FOLDER" NAME="$ROOT"`. Tipi: `FOLDER`, `PLAYLIST` (figlio `ENTRY>PRIMARYKEY TYPE="TRACK" KEY="Macintosh HD/:…/:file.mp3"`), `SMARTLIST` (figlio `SEARCH_EXPRESSION QUERY` es `$PLAYED == TRUE`, `$IMPORTDATE >= MONTHS_AGO(1)`, `$RATING == 5`). File reale: 3 SMARTLIST + 4 PLAYLIST. Le playlist referenziano i brani **per PATH** (`VOLUME + DIR + FILE` con separatore `/:`), non per ID. Il reader gestisce `FOLDER`/`PLAYLIST` ricorsivi (salta `$ROOT`); **MANCA il supporto SMARTLIST** (ignorate). Il writer emette solo `NODE PLAYLIST` piatte sotto `$ROOT`.

#### Backup
`Backup/Collection/*.nml` (zippati/datati a ogni avvio/chiusura) + `collection.nml.bak`. Non ispezionato su questo Mac. **CrateForge è read-only sull'originale e l'export scrive sempre un file NUOVO** (nmlWriter emette `NML VERSION="19"`, non tocca l'originale) → nessun backup necessario.

#### Cartelle musica & path
`LOCATION`: `VOLUME="Macintosh HD"` (nome del volume, **non** mount point), `DIR` con componenti separati da `/:` (con `/:` iniziale e finale), `FILE`. Su Windows `VOLUME="C:"`. Traktor identifica per `VOLUME+DIR+FILE` con fallback `AUDIO_ID`. Reader `traktorLocationToPath()` splitta `DIR` su `/:` e ricostruisce path POSIX assoluto.

> ⚠️ **BUG CONFERMATO:** su macOS il reader (`nmlReader.ts:20`) **scarta il nome VOLUME** e ricostruisce da `/` → un file su `/Volumes/USB/…` diventa `/Music/…` (path **errato** per volumi non-boot). Il writer (`nmlWriter.ts:141` `traktorVolume()`) matcha solo `^[A-Za-z]:` e scrive `VOLUME=""` per ogni path macOS/Linux.

#### Hot cue & loop
Tutti `CUE_V2` dentro `ENTRY`. Distinti da `TYPE` (0=cue, 1=fade-in, 2=fade-out, 3=load, 4=grid, 5=loop) e `HOTCUE` (numero pad **0-based**, oppure `-1` = non assegnato = memory/unmapped). Un saved loop = `TYPE=5` con `LEN>0`; **può avere `HOTCUE≥0`** (loop su pad).

**Unità:** **millisecondi in virgola mobile (double)**. Esempi reali: `START="28306.916666"`, `START="71.622549"`, `LEN="13913.049628"`. Conferma: loop `LEN=13913.049628 ms` a BPM `137.99939` = esattamente **32 beat** (`32*60000/138 = 13913 ms`).

**Colori:** **NESSUN colore per-cue** (0 occorrenze nella NML). Il colore è derivato dal TIPO nella UI, non salvato → `NormCue.color=null` sempre.

**Distribuzione TYPE nel file reale:** `72 × TYPE=0`, `22 × TYPE=4`, `3 × TYPE=5`. HOTCUE va da 0 a 7 (+ 22 × `-1` = tutti i grid).

**Limiti:** **8 pad** (HOTCUE 0-7); max osservato = 7.

**Esempio reale** — `ENTRY TITLE="Words"` (BPM 137.99939): saved loop su pad 3 → `<CUE_V2 TYPE="5" START="41808.381649" LEN="13913.049628" HOTCUE="2">`. Hot cue da `ENTRY "Bumpy"`: `<CUE_V2 TYPE="0" START="28306.916666" LEN="0.000000" HOTCUE="1">`.

#### Altri metadati
BPM `TEMPO@BPM` float 6 decimali. Key doppia: `INFO@KEY` testuale + `MUSICAL_KEY@VALUE` 0-23 (mappa in `traktorKeys.ts`). Beatgrid: `CUE_V2 TYPE=4` (Beat Marker + `GRID BPM`), **reader la scarta**. `LOUDNESS` (autogain) presente ma **non letto**. Colori traccia: assenti in NML. `COVERARTID` non estratto.

#### Stato adapter CrateForge
Path: `src/adapters/traktor/` (`nmlReader.ts`, `nmlWriter.ts`, `traktorKeys.ts`).

- **Legge:** `ENTRY→NormTrack`; `CUE_V2→NormCue` (`mapCue`: TYPE 0=cue, 5=loop; `hotcue≥0→'hot'` con index, `hotcue=-1→'memory'`; `TYPE 5` o `LEN>0→'loop'`); scarta TYPE 1/2/3/4. Playlist `FOLDER+PLAYLIST` ricorsive.
- **Scrive:** `ENTRY` con `LOCATION/ALBUM/INFO/TEMPO/MUSICAL_KEY`, un `Beat Marker TYPE=4` di ancoraggio, hot cue `TYPE=0` (cap `index<8`), memory `TYPE=0 HOTCUE=-1`, loop `TYPE=5` con `LEN`; playlist piatte.

**PRO:** unico formato (con VirtualDJ) che legge **e** scrive; ms-float preservato in `REAL`.
**CONTRO (mancante):** (1) colori cue sempre null (NML non li ha) → persi in entrambe le direzioni; (2) **loop-su-pad**: writer forza `HOTCUE=-1` → perde l'assegnazione al pad (dato reale: loop su HOTCUE=2 e 6); (3) SMARTLIST ignorate (3/7 nodi); (4) LOUDNESS/autogain non letto; (5) ancora/fase beatgrid persa; (6) **volume non-boot mal ricostruito su macOS**; (7) rating/COVERARTID/REPEATS non gestiti.

---

### 2.4 VirtualDJ 2026 (scanner engine build 801)

Root config reale: `/Users/dj-john/Library/Application Support/VirtualDJ/` — **NON** `~/Documents/VirtualDJ` (inesistente su questo Mac).

#### Libreria / storage
Singolo XML in chiaro: `database.xml` (radice `<VirtualDJ_Database Version="2026">`, 126 righe, 11 `Song`). Ogni brano = `<Song FilePath="abs-path" FileSize="bytes">` con figli: `<Tags>` (Author, Title, Album, Composer, Remix, Year, Key, Flag), `<Infos>` (SongLength in **secondi float**, LastModified/FirstSeen unix, Bitrate, Cover), `<Scan>` (Version, **Bpm come SECONDI-PER-BEAT**, Phase, AltBpm, Volume, Key, AudioSig), e N × `<Poi>`. Indice secondario SQLite `extra.db` (tabelle `track_data`, `related_tracks`, `lyrics`) + `Cache/`, ma **le POI stanno SOLO in database.xml**. Prova BPM: `Scan Bpm="0.521746"` → `60/0.521746 = 115.0 BPM`.

#### Playlist / crate
Le playlist **non** sono in database.xml: vivono come file separati sotto `Folders/`. Questa install ha **solo smart/virtual folder** (filtri): `Folders/Filters/*.vdjfolder`, ciascuno `<FilterFolder filter="…" scope="database"/>`. Esempi reali: `Compatible songs` `filter="bpmdiff<=4 and keydiff=0"`; `Decades` `"group by year range 10"`; `Duplicates` `"duplicates"`; `Most played` `"top 50 nbplay"`. Le playlist statiche (`VirtualFolder`) sarebbero `.vdjfolder` con `<song path="…"/>`, cartelle come subdirectory filesystem + file `order`. **Nessuna playlist statica esiste in questa libreria.** Il `vdjReader` **NON** parsa `.vdjfolder` (ritorna `playlists:[]`).

#### Backup
`Backup/Automatic Database Backup.zip` (+ `…Old.zip`). Contiene `database.xml` + `extra.db` + `settings_backup.xml` + **tutti** i `Folders/filters/*.vdjfolder` — **snapshot completo** (a differenza di Serato). Restore = unzip manuale.

#### Cartelle musica & path
`Song@FilePath` = path **assoluto POSIX** (es. `/Users/dj-john/Desktop/Budha Bar/Tamer ElDerini - Monaya.mp3`), usato anche come **chiave d'identità** (`sourceId`). Nessun path relativo/bookmark. Spostare i file o cambiare mount point **orfana i brani e le loro POI**. I file referenziati sono attualmente **assenti** dal disco (`Desktop/Budha Bar` non esiste più) → ispezione GEOB non eseguibile.

#### Hot cue & loop
Tutti `<Poi>` dentro `<Song>`, distinti da `Type`. **In questa libreria NON ci sono hot cue** — solo `Type="automix"` (con `Point` = realStart/realEnd/fadeStart/fadeEnd/cutStart/cutEnd/tempoStart/tempoEnd) e `Type="remix"` (marker di sezione). Un hot cue sarebbe `<Poi Pos="seconds" Type="cue" Num="N" Name="…"/>` (`Num` 1-based); loop `Type="loop"` con `Size`; beatgrid `Type="beatgrid"`.

**Unità:** **SECONDI float** (precisione ~1e-6 s). Reali: `Pos="162.287891"`, `Pos="0.082721"`. Size loop: **non verificato** (nessun loop reale); il writer assume secondi.

**Colori:** encoding **non verificato** (nessun hot cue colorato in libreria). Trattare ogni mappatura colore come non provata.

**Limiti:** ~8 pad × pagine (`Num`); max esatto non verificabile. `settings.xml`: `hotcueSavesLoop=yes`, `getCuesFromTags="for new files"` (i tag consultati solo per file nuovi, poi persistiti in XML).

**Esempio reale** — Song *Monaya*: `<Poi Pos="0.026122" Type="automix" Point="realStart"/>`, `<Poi Pos="16.720544" Type="automix" Point="cutStart"/>`, `<Poi Name="Break 1" Pos="162.287891" Type="remix"/>`, `<Poi Name="End Break 1" Pos="200.374422" Type="remix"/>`. `Scan Bpm="0.521746"` → 115.0 BPM. **Nessun `Type="cue"` esiste in tutta la libreria reale.**

#### Altri metadati
BPM `Scan@Bpm` sec-per-beat (`60/x`); `AltBpm` half/double; `Phase` = offset beatgrid in secondi (`Phase="16.719660"`). Key sia `Tags@Key` sia `Scan@Key` (VDJ notation → Camelot via `toCamelot`). Beatgrid: solo `Bpm+Phase` (tempo costante). Waveform in `Cache/`. Volume/gain: `Scan@Volume` (moltiplicatore lineare, es. 1.303167). `AudioSig` = fingerprint. Track color: assente in questi file.

#### Stato adapter CrateForge
Path: `src/adapters/virtualdj/vdjReader.ts` + `vdjWriter.ts`.

- **Legge:** `Song→` title/artist(Author)/album/genre/year, bpm via `vdjBpm()` (`v<10 → 60/v` else literal), key, durata da `Infos@SongLength`, filesize. `mapPoi` mappa `Type cue/hotcue→'hot'` (`index=Num-1`), `loop/Size>0→'loop'` (`lengthMs=Size*1000`), `positionMs=Pos*1000`, `label=Name`.
- **Scrive:** un **nuovo** `database.xml` (Version 2024); `Tags/Infos/Scan(Bpm=60/bpm, Key)` + `Poi` per hot (`Type=cue`, `Pos.toFixed(4)`, `Num`) e loop (`Type=loop`, `Size`).

**PRO:** legge e scrive; conversione secondi→ms diretta.
**CONTRO (mancante):** (1) **`mapPoi` scarta automix/remix** → questa libreria reale importa **0 cue**; (2) `Poi@Color` mai letto (`color=null`); (3) `Poi@Point` scartato; (4) `.vdjfolder` mai parsati → **0 playlist**; (5) `Phase`/`AltBpm` non letti; (6) memory cue mai esportati; (7) Size loop assunto in secondi ma non verificato; (8) `toFixed(4)` arrotonda la precisione ~1e-6 s.

---

### 2.5 Engine DJ (Denon / InMusic)

> Indagine su libreria reale: `/Users/dj-john/Music/Engine Library/Database2/m.db` (3709 brani, 5 playlist). DB copiati in `/tmp` e aperti in sola lettura (`sqlite3` + `python3.13` zlib/struct). Ogni valore qui sotto è estratto dai dati veri.

#### Libreria / storage
- **Versione schema**: tabella `Information` → `schemaVersionMajor.Minor.Patch = 3.0.2`, `uuid = fc18a8c8-b559-4fbe-a8c8-b67f52664a5f`. (Sull'HD esterno `/Volumes/Engine DJ/` non c'è una Engine Library: solo l'installer `Engine DJ_5.0.0_Setup.pkg`.)
- **File DB in `Database2/`**: `m.db` (libreria principale, 221 MB), `hm.db` (history), `rbm.db` (mirror rekordbox, 208 MB), + `fsm/itm/sm/stm/trm.db` (sotto-DB di servizio). Nessuna cifratura: SQLite in chiaro.
- **Struttura `Track`** (43 colonne, quelle rilevanti):
  - `bpm` INTEGER (arrotondato, es. 109) **e** `bpmAnalyzed` REAL (preciso, es. `109.05`). L'adapter usa correttamente `bpmAnalyzed`.
  - `key` INTEGER **0–23** (NON chromatico — vedi *Altri metadati*: è **ordinato Camelot**).
  - `length` INTEGER = **secondi** (es. 307), `fileBytes`, `bitrate`, `year`, `rating` (0–100), `fileType` (`mp3`/`flac`/`wav`/`m4a`).
  - `path` TEXT = **path relativo POSIX** (es. `../NEW PLAYLIST 2025/80's/DARIO CAMINITA/…​.mp3`), `filename` TEXT = solo basename.
  - `isAnalyzed`, `isBeatGridLocked`, `originDatabaseUuid`/`originTrackId` (link all'origine rekordbox), `lastEditTime`, `albumArtId`.
- **Dove sta l'analisi**: NON in `Track`, ma nella tabella **`PerformanceData`** (1 riga per brano, PK `trackId`), colonne BLOB: `trackData`, `overviewWaveFormData`, `beatData`, `quickCues`, `loops` (+ `thirdPartySourceId`, `activeOnLoadLoops`). Waveform di overview anche in `OverviewData/`, artwork in `AlbumArt` (2379 righe) e `Artwork/`.

#### Playlist / crate
- **5 playlist reali** (`Playlist`), gerarchia via `parentListId` (0 = radice) e ordinamento fratelli via `nextListId` (lista concatenata):
  - `80's` (id 1, radice) → figlia `Dario Caminita` (id 2, parent 1)
  - `70` (id 3, radice) → figlia `Funky & Disco Groove (1977–1985)` (id 4, parent 3)
  - `Michela Dj` (id 5, radice, `isExplicitlyExported=1`)
  - Catena radice: `nextListId` 1→3→5.
- **`PlaylistEntity`** (316 righe): ordinamento interno con **lista concatenata** `nextEntityId` (0 = fine), `listId`, `trackId`, `membershipReference=1`, `databaseUuid` = UUID libreria (self-ref). Esempio testa lista 1: entity id1(track126)→id2(track98)→id3(track67)→…​
  - Nota modello Engine: una playlist **padre aggrega i brani dei figli** (lista `80's`=136 entry, `Dario Caminita`=136; `70`=20, figlia=20; `Michela Dj`=4). Le tabelle `PlaylistAllChildren`/`PlaylistAllParent` materializzano l'albero.
- **`Smartlist`** (playlist intelligenti): **0 righe** in questa libreria. Schema previsto: `listUuid`, `title`, `rules` TEXT (criteri), catena via `nextPlaylistPath`/`nextListUuid`. Qui non ce ne sono, quindi i criteri non sono stati osservati su dati veri.

#### Backup
- **Meccanismo nativo = copia completa della cartella**: `Engine Library Backup/Database2/` contiene una **copia integrale** di tutti i `*.db` (m/hm/rbm/…). NON è incrementale né uno zip datato: è uno snapshot completo (feature "Backup Library" di Engine, manuale/on-demand).
- Il backup ha **stesso UUID libreria** (`fc18a8c8…`) ma **schema più vecchio** (`3.0.1` vs `3.0.2` live) e 3709 brani → è un punto-nel-tempo precedente (datato Oct 10 2025); md5 diverso dal live.
- **`hm.db` NON è un backup**: è il **DB di History** (tabelle `Historylist`/`HistorylistEntity` = sessioni DJ registrate), UUID diverso (`59f19ad6…`), vive accanto a `m.db`.
- `ChangeLog` vuoto (0 righe, serve al sync multi-device tra drive), `Pack` vuoto. Presenza di `rbm.db` + `lastRekordBoxLibraryImportReadCounter` + `originDatabaseUuid` sulle tracce ⇒ questa libreria è stata **importata da rekordbox**.

#### Cartelle musica & path
- `Track.path` = **path relativo** con separatori POSIX, prefisso `../`, **relativo alla cartella `Engine Library`** (non a `Database2`). Verificato: `../NEW PLAYLIST 2025/…` risolve in `/Users/dj-john/Music/NEW PLAYLIST 2025/…` (file esistenti, cross-checkati con mutagen). Distribuzione prefissi reali: `../NEW P…` ×3409, `../rekordbox/…` ×160, `../../Desktop/…` ×140.
- `Track.filename` = solo il nome file; `Track.uri` **vuoto** in questa libreria (non usato).
- **Portabilità / drive esterni**: il path relativo è la scelta pensata per USB/SD sui player standalone Denon/Prime — la libreria è auto-contenuta rispetto alla root del drive. Qui 2 brani hanno `isAvailable=0` (i file `../../Desktop/…` sono stati spostati/rimossi), a conferma che i path sono relativi e possono restare "dangling".

#### Hot cue & loop
**PerformanceData** — packaging verificato byte per byte:
- `trackData`, `beatData`, `quickCues`, `overviewWaveFormData` = **`[4 byte BE = lunghezza decompressa][stream zlib 78 9c]`** (framing **big-endian**). NON è raw: va decompresso con `zlib.decompress(blob[4:])`.
- `loops` = **NON compresso**, dati grezzi **little-endian**.

**`quickCues` (HOT CUE)** — struttura verificata (consumo esatto 144/144 byte su un brano con cue):
```
header:  int64 BE = numero slot hot cue = 8   (sempre 8: 3709/3709 brani)
×8 slot: uint8 label_len | label UTF-8 | double BE position(SAMPLE) | 4 byte colore ARGB
trailer: double BE adjusted_main_cue | uint8 is_main_cue_adjusted | double BE default_main_cue
slot vuoto: label_len=0, position = -1.0, colore = 00 00 00 00
```
Esempio **reale, trackId 6** (sample rate 44100, da `trackData`):
| slot | label | byte position (hex double BE) | samples | **ms** | colore (hex) | RGB |
|---|---|---|---|---|---|---|
| 0 | `Cue 1` | `41 44 2f 17 40 00 00 00` | 2 645 550.5 | **59 989.8** | `ff f4 d3 38` | (244,211,56) |
| 1 | `Cue 2` | `41 3c 85 19 cc cc cc cc` | 1 869 081.8 | **42 382.8** | `ff ef 81 30` | (239,129,48) |
| 2 | `Cue 3` | `41 25 df f1 cc cc cc cd` | 716 792.9 | **16 253.8** | `ff aa 55 c4` | (170,85,196) |

- **Unità posizione = SAMPLE** (double, big-endian). **Formula → ms**: `ms = position_samples / sampleRate × 1000`, dove `sampleRate` è **per-traccia** (letto da `trackData`/`beatData`, primo double BE). ⚠️ **Non è sempre 44100**: distribuzione reale `44100 ×3260, 48000 ×374, 22050 ×74, 32000 ×1`. Usare 44100 fisso corrompe i brani a 48k/22k/32k.
- **Colore = 4 byte ARGB**, primo byte = flag alpha/enabled (`0xff` se attivo, `0x00` se vuoto), poi R,G,B. È **RGB pieno personalizzabile**, non un indice palette (osservati 13 colori RGB distinti nella libreria).
- **N° max hot cue = 8 slot** (pad), header sempre = 8. Nessun concetto di "memory cue" separato: Engine ha 8 hot cue + 1 **main cue** (nel trailer: `default_main_cue`/`adjusted_main_cue`, in sample). 8/3709 brani hanno il main cue spostato (es. trackId 3706: adjusted 40 263 ms, default 286 ms).

**`loops` (LOOP)** — struttura verificata (consumo 192/192, **little-endian**):
```
header:  int64 LE = numero slot loop = 8   (sempre 8)
×8 slot: uint8 label_len | label | double LE start(SAMPLE) | double LE end(SAMPLE)
         | uint8 is_start_set | uint8 is_end_set | 4 byte colore
```
Esempio **reale, trackId 6 (loop attivo)** — slot 6 `Loop 7`: start `4 163 835` samples = **94 418 ms**, end `4 541 331` samples = **102 978 ms** (lunghezza **8 560 ms**), `is_start=1 is_end=1`, colore `ff ff 8c 00` (RGB 255,140,0). Stessa unità sample e stessa formula ÷ sampleRate.

**`beatData` (BEATGRID)** — header **BE**, marker **LE** (endianness mista, verificata):
```
double BE sample_rate | double BE total_samples | uint8 is_set
DEFAULT grid:  int64 BE count | count × marker(24 byte)
ADJUSTED grid: int64 BE count | count × marker(24 byte)
marker(24B, LE): double sample_offset | int32 beat_index | int32 … 
```
Verifica: trackId 6 → beat 0 (downbeat/**anchor**) a sample 49 295 (1.118 s), beat 609 a fine; 609 beat / 335.07 s = **109.06 BPM** ≈ `bpmAnalyzed 109.05` ✔. Default e adjusted qui identici.

#### Altri metadati
- **Key (`Track.key`, intero 0–23) = ordinamento CAMELOT, NON chromatico.** Mappatura **derivata statisticamente da 400 file reali** (tag ID3 Camelot via mutagen); per ogni intero 0–23 il valore Camelot dominante forma una sequenza monotòna perfetta:
  - Regola: `camelotNumber = (key >> 1) + 1` (1–12); **pari = major (lato B/"d"), dispari = minor (lato A/"m")**.
  - Es.: `0→1B (B)`, `1→1A (Abm)`, `2→2B (Gb)`, `13→7A (Dm)`, `14→8B (C)`, `15→8A (Am)`, `19→10A (Bm)`, `23→12A (C#m)`.
  - ⚠️ Questo **smentisce** l'assunzione "0=C" (in realtà 0 = **B major**). È lo stile Camelot/Open-Key (Lexicon-like) citato nella richiesta.
- **Gain / loudness**: in `trackData` (44 byte, BE) → `double sample_rate @0` | `int64 total_samples @8` | `int32 key @16` (spesso −1 sui brani importati da rekordbox) | **3 double `average_loudness` @20/@28/@36**, normalizzati 0..1 (es. trackId 137 = `0.774`). Brani solo-import rekordbox hanno loudness = 0 (non ri-analizzati da Engine).
- **Rating**: `Track.rating` INTEGER 0–100 (es. 80). **Colore traccia**: non presente come colonna dedicata in questo schema (i colori sono per-cue, non per-traccia). **Beatgrid**: anchor = marker beat 0 (vedi sopra), con grid `default` + `adjusted`.

#### Stato adapter CrateForge
- **`src/adapters/engine/engineReader.ts`** — legge in sola lettura (`better-sqlite3`, `readonly`), introspezione difensiva delle colonne. **Importa già**: brani (`title/artist/album/genre/year`), `bpmAnalyzed→bpm`, `length→durationS`, `path` (reso assoluto risalendo di 2 livelli), `fileBytes→filesize`; **playlist** seguendo correttamente la catena `nextEntityId` (testa = entity non referenziata) e `parentListId→parentSourceId`.
- **NON fa**: (1) **cue/loop** — imposta `cues: []` e avvisa esplicitamente *"cue e loop (blob PerformanceData) non ancora importati"*; (2) `Smartlist`; (3) nessun `isFolder`.
- **BUG VERIFICATO — mappa key errata**: `ENGINE_KEY` in `engineReader.ts` (righe 17–22) è **chromatica** (`0:'C', 1:'C#', … 12:'Cm'`) ma l'encoding reale è **Camelot-ordinato** (`0 = B major`). Risultato: `musicalKey` sbagliato su **ogni** brano. Va sostituita con la mappa Camelot verificata sopra.
- **`src/adapters/engine/index.ts`** — `ENGINE_STATUS.available = false`: **nessuna scrittura diretta** verso Engine (rischio corruzione schema), rimanda a export Rekordbox XML / Traktor NML.
- **Pivot `src/core/foreignImport.ts`** — `NormCue { type:'hot'|'memory'|'loop', index, positionMs, lengthMs, color, label }`. Mapping Engine→pivot ben coperto: hot cue→`type:'hot'`, loop→`type:'loop'` con `lengthMs = end−start`. Engine **non ha memory cue** (solo 8 hot + 1 main + 8 loop) → il main cue potrebbe mappare a `'memory'`.
- **Cosa serve per LEGGERE i cue Engine**: per ogni `trackId` → leggere `sampleRate` da `trackData`/`beatData`; decomprimere `quickCues` (zlib, header BE) e parsare gli 8 slot; parsare `loops` (LE); convertire sample→ms con **la sample rate del brano** (non 44100 fisso); ARGB→hex; popolare `NormCue[]`.
- **Cosa serve per SCRIVERE i cue Engine**: costruire il blob `quickCues` (BE, 8 slot fissi, `[len BE]+zlib`) e `loops` (LE, non compresso), convertire ms→sample con la sample rate del brano, impacchettare ARGB. Vincolo: **max 8 hot cue**; cue oltre l'ottavo o di tipo `'memory'` non hanno slot nativo.

## 3. Interscambio hot-cue: unità, tipi, colori, limiti

Il pivot memorizza `position_ms REAL` e `length_ms REAL` (millisecondi assoluti, non quantizzati).

### 3.1 Formule di conversione verso/da millisecondi

| Software | Unità sorgente | → position_ms (READ) | ← da position_ms (WRITE) | Perdita |
|---|---|---|---|---|
| **Rekordbox** (DjmdCue) | `InMsec` ms interi. `InFrame = floor(InMsec*0.15)` @150 fps | `position_ms = InMsec` | `InMsec = round(position_ms)`; `InFrame = (InMsec*150)//1000` | Nessuna (intero) |
| **Rekordbox** (XML) | `Start` = SECONDI 3 dec | `position_ms = Start*1000` | `Start = (position_ms/1000).toFixed(3)` | Quantizza a 1 ms |
| **Serato** (Markers2) | uint32 BE **ms interi** | `position_ms = uint32` | `uint32 = round(position_ms)` | Nessuna |
| **Traktor** (CUE_V2) | `START`/`LEN` ms **float** | `position_ms = parseFloat(START)` | `START = position_ms.toFixed(6)` | Nessuna → pivot; sub-ms perso via XML RB |
| **VirtualDJ** (Poi) | `Pos` **secondi** float | `position_ms = Pos*1000` | `Pos = (position_ms/1000).toFixed(4)` | 0.1 ms in uscita |
| **Engine** | **sample** (double, BE) | `position_ms = sample/SR*1000` | `sample = position_ms/1000*SR` | **SR per-traccia** (44.1/48/22/32 kHz), mai fisso a 44.1k |

> ⚠️ **Nota `InFrame` (correzione verificata):** `floor`, **non** `round`. `round(294690*0.15)=44204` ≠ valore reale `44203 = floor`.

**Punto chiave:** la conversione **temporale** è sostanzialmente **lossless** ovunque, tranne il round-trip che passa dall'XML Rekordbox (quantizzazione a 1 ms) e da Engine (al sample). Il pivot in `REAL` preserva i ms-frazionari di Traktor.

### 3.2 Mappatura dei tipi

| Tipo | Rekordbox | Serato | Traktor | VirtualDJ | Engine ⚠️ | → Pivot |
|---|---|---|---|---|---|---|
| **Hot cue** | `Kind≥1` (ordinale, non slot) | `CUE` idx 0-7 | `TYPE=0 HOTCUE≥0` | `Type=cue Num` 1-based | slot 0-based | `type=hot`, index normalizzato |
| **Memory cue** | `Kind=0` (XML `Num=-1`) | assente | `TYPE=0 HOTCUE=-1` | assente | non nativo | `type=memory`, index=null |
| **Saved loop** | `OutMsec!=-1` | `LOOP` (start/end ms) | `TYPE=5 LEN>0` (può avere HOTCUE) | `Type=loop Size` | start/end sample | `type=loop`, length_ms |
| **Beatgrid** | ANLZ PQTZ | GEOB BeatGrid | `TYPE=4 +GRID` | Scan Bpm+Phase | blob grid | **NON è un cue** — mai in `cues` |
| **Load/fade** | attributi | — | `TYPE=1/2/3` | `automix` | — | scartati (segnalare) |

**Criticità sui tipi:**
- **Off-by-one indice pad**: Rekordbox DB `Kind` è **ordinale non-contiguo** (1,2,3,**5**,6,7,8,9 — il 4 è riservato ai loop), XML `Num` 0-based, Traktor `HOTCUE` 0-based, VirtualDJ `Num` 1-based, Serato 0-based. Il pivot deve fissare **una** convenzione (raccomando **0-based interno**) e ogni adapter converte. Attenzione: per Rekordbox-DB **non** basta `index=Kind-1`, va gestita la non-contiguità (Kind≥5 → pad = Kind-2).
- **Loop su pad**: Traktor `TYPE=5 HOTCUE=2`. Il pivot lo rappresenta (`type=loop` + `index`), ma il writer Traktor forza `HOTCUE=-1` → perde l'assegnazione.
- **Memory cue** è quasi esclusivo Rekordbox/Traktor(unmapped). Verso Serato/VirtualDJ/Engine va **promosso a hot** (consumando slot) o **scartato**: entrambe lossy, da esporre all'utente.

### 3.3 Colori: palette fisse vs RGB liberi

| Software | Storage | Natura | → pivot (hex) | ← dal pivot |
|---|---|---|---|---|
| **Rekordbox DB** | `Color` = indice palette (`-1` default); valori `[-1,1,2,4,255]` | indice | serve mappa indice→RGB (**assente**) → colore perso | nearest-color se si scrivesse nel DB |
| **Rekordbox XML** | `Red/Green/Blue` 0-255 (solo hot) | RGB | letto da rgbAttrs | `colorAttrs()` |
| **Serato** | 3 byte RGB. Default `#cc0000…#8800cc` | RGB | diretto | diretto |
| **Traktor** | **nessuno** (derivato dal tipo) | — | `null` sempre | non scrivibile |
| **VirtualDJ** | attributo non verificato | ignoto | non affidabile | non emesso |
| **Engine** | ARGB nel blob (byte0=alpha, poi R,G,B), `quickCues`/`loops` | RGB pieno, **verificato** (13 colori reali) | diretto | diretto |

**Strategia:** RGB↔RGB (Serato ↔ XML RB ↔ Engine) diretto e lossless. Indice palette RB-DB → hex: serve **tabella statica dei colori-pad di default** (distinta da `DjmdColor`, che è la palette **traccia** a 8 colori). hex → indice: nearest-color euclideo (solo per scrittura DB). Traktor: nessun colore sorgente; in uscita si può assegnare un default per-tipo/per-pad (sintesi, non dato reale).

### 3.4 Limiti

| Software | Max hot | Max memory | Max loop | Note |
|---|---|---|---|---|
| **Rekordbox 7 (DB)** | fino a **16** (osservato slot 14, brano con 11) | ~6+ | multipli | limite 8 non è di rekordbox |
| **Rekordbox XML** | **8** (cap duro) | illimitati | **non emessi** | slot 9-16 persi |
| **Serato** | **8** (0-7) | — | 8 | cap rigido |
| **Traktor** | **8** (0-7) | illimitati | multipli | |
| **VirtualDJ** | ~8 × pagine | n/a | sì | max non verificato |
| **Engine** ⚠️ | 8 | n/a | 8 | tipico 8-pad |

**Regola:** il cap va applicato nel **writer di destinazione**, mai nel pivot — così RB7→RB7 nativo mantiene gli slot 9-16.

### 3.5 Lossless vs lossy

**Lossless (≤ 1 ms):** asse temporale ms↔ms↔float con pivot `REAL`; RGB↔RGB; hot cue entro 8 slot; label.

**Lossy (strutturale):**
- **Tipo memory** verso Serato/VirtualDJ/Engine.
- **Colore** in ogni rotta con Traktor, o path master.db senza mappa indice→RGB.
- **Slot 9-16** RB7 via XML/Serato/Engine.
- **Loop**: esclusi dal writer XML RB; loop-su-pad perso nel writer Traktor.
- **Beatgrid/fase**: griglia sintetica BPM-costante da 0 → disallinea cue su tempo variabile o downbeat ≠ 0.
- **Off-by-one/non-contiguità** indice pad se non gestita.
- **Quantizzazione**: sub-ms Traktor → 1 ms via XML RB; ms → sample via Engine.

---

## 4. Path, portabilità e backup

### 4.1 Come ciascun software memorizza la posizione dei file

| Software | Campo | Schema | Portabilità drive esterno | Identità |
|---|---|---|---|---|
| **Rekordbox** | `FolderPath` / `Location` | **ASSOLUTO**; XML = URI `file://localhost/…` | Rotta (brano mancante) | path assoluto |
| **Serato** | `pfil` / `ptrk` | **VOLUME-RELATIVO senza slash iniziale** | **Buona** | path relativo (cue nei tag ID3) |
| **Traktor** | `VOLUME + DIR + FILE` | nome-volume + componenti `/:` | Media (fallback `AUDIO_ID`) | VOLUME+DIR+FILE + fingerprint |
| **VirtualDJ** | `FilePath` | **ASSOLUTO POSIX** | Rotta | FilePath |
| **Engine** ⚠️ | `Track.path` | relativo alla root Engine | Buona nel drive | id + path relativo |

**Conclusione:** solo **Serato** (e in parte Engine) è progettato per la portabilità drive-to-drive. In Serato e Traktor le cue sono legate al path/tag → perdere il collegamento = perdere le cue.

### 4.2 Bug di portabilità CONFERMATI nel codice

| # | File / riga | Difetto | Impatto |
|---|---|---|---|
| B1 | `traktor/nmlWriter.ts:141` `traktorVolume()` | regex solo `^[A-Za-z]:` → `VOLUME=""` su macOS/Linux | Traktor non ritrova i file su altro Mac/drive |
| B2 | `traktor/nmlReader.ts:20` `traktorLocationToPath()` | scarta `volume`, ricostruisce da `/` | file su `/Volumes/USB/…` → `/Music/…` (path errato) |
| B3 | `common.ts:88` `pathToLocation()` | non normalizza il nome-volume | round-trip cross-drive incoerente |
| B4 | `relocator/` + `relocationXml.ts` | rilocazione SOLO Rekordbox | inutilizzabile per Traktor/VDJ/Serato/Engine |
| B5 | `relocator.ts:58 matchByFilename` | match solo per basename; `fingerprint` in schema ma non implementato | nomi uguali → `ambiguous`, nessun fallback acustico |

### 4.3 Backup nativi

| Software | Backup nativo | Contiene | NON protegge |
|---|---|---|---|
| **Serato** | `Export Backups/*.zip` (auto) | **SOLO** `database V2` | **crate + tag ID3 con le cue** |
| **Rekordbox** | `master.backup.db/2/3` (cifrati, rotanti) + zip manuale | copia cifrata DB | ANLZ + file audio |
| **VirtualDJ** | `Automatic Database Backup.zip` | `database.xml`+`extra.db`+settings+`.vdjfolder` (**completo**) | file audio (ma POI coperte) |
| **Traktor** | `Backup/Collection/*.nml` + `.bak` | snapshot NML | file audio + PRIV mirror |
| **Engine** ⚠️ | Engine Library Backup | copia DB | file audio |

**Insight critico:** il backup Serato salva **solo il database** → chi vi si affida per le cue **sbaglia** (le cue sono nei tag ID3). Qualsiasi scrittura futura verso Serato **muta i file audio** e va protetta con un **backup dei FILE**.

### 4.4 Stato del backup in CrateForge

- `incrementalBackup.ts`: **già scritto e ben fatto** — `planBackup` (dry-run) + `executeBackup` (snapshot DB datato PRIMA di tutto, poi copia incrementale stile rsync con `copyWithVerify` a hash). Originali in sola lettura.
- **NON agganciato al flusso di conversione**: `grep` su `ConverterPage.tsx` e adapter → zero chiamate. È solo la `BackupPage` manuale.
- Oggi la conversione è **non-distruttiva**: tutti i writer fanno `writeFileSync` su file NUOVO. Il rischio è **futuro**: il writer Serato dovrà scrivere GEOB nei file audio reali.

### 4.5 Raccomandazioni path & backup

1. **P0 — Backup automatico obbligatorio prima di ogni conversione distruttiva.** Agganciare `executeBackup()` nel flusso di export. Regola dura: se la destinazione muta i file audio (writer Serato futuro, scrittura diretta master.db), il **backup dei file audio è bloccante**.
2. **P0 — Fix volume Traktor macOS (B1+B2):** `traktorVolume()` deve restituire il nome reale del volume; `traktorLocationToPath()` deve ricostruire `/Volumes/<name>/…` per drive non-boot.
3. **P1 — Adottare internamente lo schema path VOLUME-RELATIVO di Serato** come rappresentazione canonica: in UDM memorizzare `(volume_name, volume_relative_path)` oltre al path assoluto.
4. **P1 — Snapshot del backup NATIVO della destinazione + avviso software-in-esecuzione** prima di leggere/scrivere.
5. **P1 — Relocator multi-formato (B4):** writer di rilocazione per Traktor (preservando `AUDIO_ID`), VirtualDJ (nuovo `FilePath`), Serato (ricalcolo path volume-relativo).
6. **P2 — Match a due stadi con fallback fingerprint (B5):** basename → Chromaprint/fpcalc, riusando `AUDIO_ID` (Traktor) e `AudioSig` (VDJ).
7. **P2 — Manifest di backup** (lista file, size, hash, timestamp, software+versione, path originali) per rollback verificabile.
8. **P2 — Dialog pre-export** che dichiara esplicitamente cosa NON è coperto/portabile.

---

## 5. Matrice di conversione bidirezionale

**Legenda perdita:** L=bassa, M=media, H=alta/totale. Colonne: Pl=playlist, Cue, Grid=beatgrid, Gain, Rat=rating.
"Sopra il cofano" = nativo + step manuali. "Sotto il cofano" = automatizzabile da CrateForge.

> ⚠️ Le capacità di import/export **nativo** cross-software derivano da conoscenza dei formati (non tutte verificabili su questa macchina) e variano per versione. I **formati on-disk** dei 5 software — inclusi i blob Engine `PerformanceData` — sono invece **verificati sui file reali** di questo Mac.

| # | Sorgente → Dest. | Sopra il cofano | Sotto il cofano | Pl | Cue | Grid | Gain | Rat | Stato CF oggi |
|---|---|---|---|---|---|---|---|---|---|
| 1 | RB → Serato | Serato "Import from Rekordbox" (serve RB XML manuale) | DjmdCue → GEOB Markers2 | L | **H** | H | H | H | Rotto: DB-cue non letti; writer Serato stub |
| 2 | RB → Traktor | nessun import nativo | DjmdCue → CUE_V2 | L | **H** | H | H | H | Cue persi (DB); NML writer ok |
| 3 | RB → VirtualDJ | VDJ legge libreria RB (auto) | DjmdCue → Poi | M | **H** | H | H | H | Cue persi in ingresso |
| 4 | RB → Engine | Engine importa RB con cue (auto) | DjmdCue → PerformanceData | M | **H** | H | H | H | Writer Engine assente |
| 5 | Serato → RB | RB XML da terzi | GEOB → POSITION_MARK | M | **H** | H | H | H | Reader Serato assente |
| 6 | Serato → Traktor | nessun nativo | GEOB → CUE_V2 | M | **H** | H | H | H | Reader Serato assente |
| 7 | Serato → VirtualDJ | VDJ legge crate+GEOB (auto) | GEOB → Poi | M | **H** | H | H | H | Reader Serato assente |
| 8 | Serato → Engine | Engine importa Serato (auto) | GEOB → PerformanceData | M | **H** | H | H | H | Reader + writer assenti |
| 9 | Traktor → RB | nessun nativo | CUE_V2 → POSITION_MARK; **loop persi** | L | M | H | H | H | **Parziale**; loop persi, colori assenti, grid sintetica |
| 10 | Traktor → Serato | nessun nativo | CUE_V2 → GEOB | L | M | H | H | H | Reader NML ok; writer Serato assente |
| 11 | Traktor → VirtualDJ | VDJ legge NML (auto) | CUE_V2 → Poi | L | M | H | H | H | **Entrambi ok**; smartlist perse, loop-su-pad perde slot |
| 12 | Traktor → Engine | Engine importa Traktor (auto) | CUE_V2 → PerformanceData | L | M | H | H | H | Writer Engine assente |
| 13 | VirtualDJ → RB | nessun nativo | Poi → POSITION_MARK; **automix/remix scartati** | H | M | H | H | H | reader scarta automix/remix e .vdjfolder → 0 pl, 0 cue |
| 14 | VirtualDJ → Serato | nessun nativo | Poi → GEOB | H | M | H | H | H | writer Serato assente |
| 15 | VirtualDJ → Traktor | nessun nativo | Poi → CUE_V2 | H | M | H | H | H | reader VDJ perde pl e POI non-cue |
| 16 | VirtualDJ → Engine | parziale nativo | Poi → PerformanceData | H | M | H | H | H | writer Engine assente |
| 17 | Engine → RB | Engine esporta RB XML | PerformanceData → POSITION_MARK | L | **H** | H | H | H | reader Engine metadati+pl, **cue=[]** |
| 18 | Engine → Serato | nessun nativo | PerformanceData → GEOB | L | **H** | H | H | H | cue non letti; writer Serato assente |
| 19 | Engine → Traktor | nessun nativo | PerformanceData → CUE_V2 | L | **H** | H | H | H | cue non letti; NML writer ok |
| 20 | Engine → VirtualDJ | parziale | PerformanceData → Poi | L | **H** | H | H | H | cue non letti; vdjWriter ok |

**Pattern chiave:**
- **Cue = H** in tutte le coppie che leggono Rekordbox-DB (1-4), Serato (5-8,10,14,18) ed Engine (17-20): **3 dei 5 software non consegnano nemmeno un cue nel pivot**. Solo Traktor→\* e VirtualDJ→\* portano i cue (M).
- **Grid, Gain, Rating = H quasi ovunque** — limite dell'UDM, non dei formati.
- **Playlist = H per VirtualDJ-in-lettura** (nessun `.vdjfolder`).

**Canale nativo (sopra il cofano):**
- **Rekordbox Collection XML** = lingua franca de-facto (Serato/Engine/VirtualDJ la ingeriscono), ma richiede export manuale e **cappa a 8 hot cue**.
- **VirtualDJ ed Engine** = aggregatori nativi (leggono librerie altrui). Traktor e Rekordbox sono i più chiusi.

---

## 6. Cosa automatizzare (per rotta)

Per ogni rotta, i **passaggi manuali** che l'utente farebbe oggi e come CrateForge li **elimina**.

| Rotta | Passaggi manuali oggi | Come CF li elimina |
|---|---|---|
| **RB → \*** | 1) Export "collection XML" a mano; 2) puntare il SW di destinazione; 3) rilocare i file; 4) accettare cap 8 + perdita loop/colori | Leggere `DjmdCue` dal master.db (bypassa l'export XML manuale), mappare direttamente al writer di destinazione **senza** cap XML e **senza** perdita loop |
| **Serato → \*** | 1) far leggere i crate/GEOB al SW target (solo VDJ/Engine lo fanno); per RB/Traktor **impossibile** | Reader GEOB Markers2 nel sidecar → pivot → qualunque writer; abilita rotte oggi inesistenti (Serato→RB/Traktor) |
| **Traktor → RB** | 1) nessun import nativo → di fatto impossibile senza tool | Già parziale; va **aggiunto l'export dei loop** (POSITION_MARK con End) |
| **Traktor → VDJ** | 1) VDJ legge NML (auto) ma perde smartlist/loop-su-pad | CF preserva loop-su-pad (non forzare HOTCUE=-1) e converte SMARTLIST |
| **VDJ → \*** | 1) nessun import nativo verso RB/Traktor/Serato | Estendere `mapPoi` (automix/remix) + parser `.vdjfolder` → oggi importa 0 cue e 0 playlist |
| **Engine → \*** | 1) Engine esporta solo RB XML; per Serato/Traktor nulla | Decodifica blob `PerformanceData` (sample→ms con SR) → pivot → qualunque writer |
| **\* → Serato** | scrittura cue **impossibile** senza toccare i tag ID3 a mano | Writer GEOB (Markers2 + Markers\_) su **copie** con backup obbligatorio |

**Principio trasversale:** il valore di CrateForge è nel **"sotto il cofano"** — leggere/scrivere direttamente `DjmdCue`, i GEOB ID3 e i blob `PerformanceData`. È l'unico modo per **eliminare i passaggi manuali** e **superare il cap a 8** e la perdita di loop/colori imposti dal canale XML.

---

## 7. Roadmap CrateForge prioritizzata

**Feasibility:** A=alta (formato noto + lib presente), M=media, B=bassa (reverse engineering / blocco tecnico).

| Ord. | Tool / funzione | Stato attuale | Problema risolto | Feas. | Rischi / note |
|---|---|---|---|---|---|
| **1** | **Reader `DjmdCue` in `cmd_ingest_masterdb`** | 0 cue letti dal DB | Elimina la perdita **totale e silenziosa** dei cue nell'import RB nativo | **A** | pyrekordbox li espone già; `Kind=0→memory`, `Kind≥1→hot`, `OutMsec≠-1→loop` |
| **2** | **Emettere i loop nel writer RB XML** | writer esclude i loop | Loop non più persi in `Traktor/VDJ/Engine→RB` | **A** | `POSITION_MARK End=(position_ms+length_ms)/1000` |
| **3** | **Off-by-one + non-contiguità `Kind` + slot 9-16** | non gestito | Lettere hot cue corrette; niente perdita slot 9-16 | **A** | ⚠️ **non** `index=Kind-1`: Kind è ordinale non-contiguo (4 riservato ai loop); pad = Kind-2 per Kind≥5 |
| **4** | **Mappa indice-palette RB → RGB** | assente | Recupera i colori dei cue letti dal DB | **A/M** | tabella statica palette pad; distinta da `DjmdColor` (palette traccia) |
| **5** | **Estendere UDM: gain, rating, track_color, beatgrid_anchor** | schema `cues` ok, `track` senza questi campi | Unica causa di perdita di gain/rating/color/fase in OGNI rotta | **M** | prerequisito abilitante; aggiungere colonne + reader/writer |
| **6** | **VirtualDJ: mappare automix/remix + parser `.vdjfolder`** | scarta i non-cue; ignora le playlist | Librerie VDJ reali importano 0 cue e 0 playlist | **M** | `mapPoi` accetta automix/remix (→memory/label); parser FilterFolder/VirtualFolder + gerarchia `%%`/cartelle |
| **7** | **Traktor: loop-su-pad + SMARTLIST + volume non-boot** | HOTCUE=-1 forzato; smartlist ignorate; path esterni errati | Round-trip Traktor senza perdere pad-loop, smart-list, `/Volumes/…` | **A** | non azzerare HOTCUE per i loop; leggere `SEARCH_EXPRESSION`; non droppare VOLUME |
| **8** | **Reader+Writer Serato GEOB** (Markers2 + Markers\_) via mutagen | stub `available:false` | Sblocca Serato in entrambe le direzioni | **M** | scrivere **entrambi** i frame; **obbligo copie+backup** (muta i file audio) |
| **9** | **Engine DJ: decodifica cue `PerformanceData` (read) + writer** | reader metadati+pl, `cue=[]`; writer assente | Abilita Engine come sorgente/destinazione completa | **M** | formato **reverse-engineered e verificato** (§2.5): `quickCues`=`[len BE]+zlib`, 8 slot, posizione in **sample double BE**, colore ARGB; `loops`=LE non compresso; convertire con la **SR per-traccia**; read-only su copie |
| **10** | **Beatgrid reale via ANLZ (RB) / GRID (Traktor)** | grid sempre sintetica BPM-costante | Fase corretta su tracce a tempo variabile | **B** | ⚠️ non bloccata da PCO2 (parsabile) ma da **PQT2 `u1=0x02000002`** che dà `ConstError` su pyrekordbox 0.4.3; serve fix/parser custom |
| **11** | **Write diretta cue nel master.db** (esperto) | solo `create_playlist` | Import verso RB senza XML manuale (no cap 8, no perdita loop) | **B** | alto rischio corruzione/lock; obbligo backup rotanti + copia; solo dopo #1-4 |

**Ordine consigliato:** **1 → 2 → 3/4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.**

> **Bug confermato a costo minimo (vedi §2.5):** la mappa `ENGINE_KEY` in `src/adapters/engine/engineReader.ts` è **cromatica** (`0=C`), ma l'encoding reale di `Track.key` in Engine è **ordinato Camelot** (`0 = B major`) → la key risulta **errata su ogni brano Engine importato**. Fix immediato (Feasibility **A**): sostituire la tabella con la mappa Camelot verificata — `camelotNumber = (key>>1)+1`, pari=major, dispari=minor.

**Razionale:** prima i fix a costo minimo che fermano perdite totali e silenziose sul percorso già funzionante (DjmdCue, loop, off-by-one/colori), poi l'estensione UDM (sblocco trasversale), poi le rifiniture VirtualDJ/Traktor (adapter già read/write), poi il grande sblocco Serato (nuovo modulo GEOB), infine Engine, la beatgrid reale e la scrittura diretta nel DB (rischio massimo).

---

## 8. Rischi, avvertenze legali/di sicurezza e principi

### 8.1 Rischi tecnici

- **Perdita silenziosa di TUTTI i cue** nell'import diretto da master.db (oggi): brani e playlist arrivano, i cue no. È il rischio più grave e invisibile all'utente.
- **Scrittura diretta nel master.db cifrato**: il DB è SQLCipher (chiave DB6). Scrivere cue/playlist mentre rekordbox è in esecuzione → rischio **lock/lettura incoerente/corruzione**. Mitigazione: lavorare su copia, avvisare se il software gira, obbligo backup rotanti.
- **Mutazione dei tag ID3 (Serato)**: scrivere i GEOB significa riscrivere i **file audio reali** dell'utente. Un errore corrompe i tag. Obbligo: **copie + backup dei file**, mai in-place al primo colpo.
- **Perdita slot 9-16** su RB7 con >8 hot cue via qualunque canale a 8.
- **Sfasamento lettere hot cue** per off-by-one/non-contiguità `Kind` se si leggono i cue dal DB senza gestire il salto del 4.
- **Colori errati/persi** senza mappa indice-palette → RGB.
- **Beatgrid sintetica** che disallinea i cue su tracce a tempo variabile o downbeat ≠ 0.
- **Path rotti su drive esterni** (bug volume Traktor confermato) → tracce non ritrovate.

### 8.2 Avvertenze legali / di sicurezza

- **Cifratura Rekordbox**: la chiave DB6 sblocca un DB cifrato dal vendor. L'uso deve restare limitato alla **libreria dell'utente stesso** sulla **sua** macchina, in sola lettura ove possibile. Non ridistribuire la chiave né il DB.
- **Formati proprietari version-dipendenti** (Serato database V2, Engine PerformanceData, ANLZ PCO2/PQT2): una scrittura ingenua può corrompere una libreria; l'adapter Serato è **volutamente disattivato** per questo.
- **Backup nativi ingannevoli**: il backup Serato copre solo il DB, non le cue. Non affidarvisi per proteggere le cue.

### 8.3 Principi operativi (non negoziabili)

1. **Sempre backup prima di scrivere** (DB + snapshot nativo destinazione + file audio se la destinazione muta i tag). Bloccante, non opzionale.
2. **Sola lettura sulle sorgenti**: aprire copie, mai l'originale in scrittura durante l'ingestion.
3. **Dry-run obbligatorio** (`planBackup` + anteprima conversione): mostrare cosa verrà scritto/troncato/perso **prima** di eseguire.
4. **Cap SOLO nel writer di destinazione**, mai nel pivot: conservare tutti i cue anche >8.
5. **Distinguere nettamente beatgrid dai cue**: `TYPE=4` (Traktor) / PQTZ (RB) non devono mai finire nella tabella `cues`.
6. **Warning espliciti con conteggi** (cue troncati, loop non emessi, colori persi, playlist non convertite), come il dialog obbligatorio già presente sui limiti del canale XML.
7. **Verificare prima di implementare** i formati non ispezionati (Engine, loop Serato, colore VirtualDJ): assunzioni marcate come non provate non diventano codice senza conferma su dati reali.

---

## 9. Conclusioni: PRO e CONTRO dell'approccio CrateForge

**PRO complessivi:**
- **Modello-pivot già corretto**: ms in `REAL` + hex + type copre tutti i formati senza modifiche di schema. Il problema è implementativo, non architetturale — quindi risolvibile a costo prevedibile.
- **Il "sotto il cofano" è la vera leva**: leggere/scrivere direttamente `DjmdCue`, GEOB e `PerformanceData` **elimina i passaggi manuali** dell'utente e **supera** i limiti del canale XML (cap 8, niente loop, colori parziali).
- **Diverse rotte oggi impossibili nativamente** (Serato→RB, Traktor→RB, VDJ→qualsiasi) diventano possibili solo attraverso un pivot come CrateForge.
- **Fix ad altissimo ROI a portata**: la Priorità #1 (leggere `DjmdCue`) è a bassa fatica e ferma la perdita più grave.
- **Infrastruttura di sicurezza già scritta** (`incrementalBackup`), va solo agganciata.

**CONTRO / limiti attuali:**
- **3 dei 5 software non consegnano un solo cue nel pivot** oggi (RB-DB, Serato, Engine): l'utente può credere di aver migrato tutto e perdere silenziosamente hot cue, memory, loop.
- **Gain, rating, track-color, beatgrid reale persi ovunque** finché l'UDM non viene esteso.
- **Scrivere verso Serato muta i file audio**: rischio intrinseco che nessun pivot elimina — richiede disciplina di backup ferrea.
- **Engine e beatgrid reale = reverse engineering** (blob packed, ANLZ PQT2 con `ConstError`): feasibility bassa, timeline incerta.
- **Bug di portabilità confermati** (volume Traktor) producono path errati su drive esterni finché non corretti.
- **Alcune perdite sono strutturali** (memory→hot verso Serato/VDJ/Engine, colori da Traktor): il pivot le può solo gestire con policy esplicite, non annullarle.

**Verdetto:** CrateForge ha l'architettura giusta e alcuni adapter già maturi (Traktor, VirtualDJ, RB-XML), ma oggi **perde silenziosamente i cue dalla maggior parte delle sorgenti**. La roadmap 1→11 trasforma un convertitore di metadati+playlist in un vero convertitore **cue-completo bidirezionale**, a patto di rispettare i principi di backup, sola-lettura sulle sorgenti e dry-run — perché il salto di valore (scrittura diretta nei DB cifrati e nei tag audio) è anche il salto di rischio.