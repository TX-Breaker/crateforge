# .ai-state — Handoff per la prossima IA

Stato della sessione di lavoro su **CrateForge** (convertitore/gestore librerie DJ).
Documento indice: rimanda ai report di dettaglio in `docs/`.

Aggiornato: 2026-07-15. Repo: `/Users/dj-john/Desktop/crateforge/crateforge`.

---

## 1. Stato del repository

- **Branch**: `feat/dj-interop-conversion` (creato da `master`).
- **Commit locali NON ancora sul remote**:
  - `97dc44d` feat(serato): reader GEOB validato su dati reali + catalogo operazioni
  - `fbfd300` feat(conversione): cue multi-software, convertitore X→Y e preflight
- **Push bloccato**: nessuna credenziale GitHub non interattiva (no token, no chiave SSH, `gh` assente); l'IA non può inserire credenziali. L'utente deve fare `git push -u origin feat/dj-interop-conversion` dal proprio terminale.
- **Da committare in questa sessione** (RE): `docs/REVERSE-ENGINEERING-LIBRERIE.md` + questo `.ai-state/`.
- **Identità git locale** impostata: `Vale <valeacer@hotmail.it>` (come la history).

## 2. Ambiente di build (IMPORTANTE)

Il toolchain Homebrew di sistema è troppo recente per i pin del progetto. Usare:
```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"      # node 22 per npm/dist
PYTHON=/opt/homebrew/bin/python3.13 bash python-sidecar/build_sidecar.sh
npm run dist        # → release/*.dmg + *.zip (non firmati, identity:null)
```
Dettagli in `docs/BUILD-MACOS.md` e nella memory del progetto.

## 3. Cosa è stato fatto e validato (sintesi)

Pipeline di conversione DJ **cue-completa** implementata e **validata sui dati reali**:
- Rekordbox: lettura hot/memory/loop da `DjmdCue` (3368 cue) + XML (3357); loop nel writer XML; fix Kind non-contiguo, palette colori, rating/track_color.
- Engine DJ: decodifica cue `PerformanceData` (860 cue) + fix key Camelot.
- Serato: reader GEOB "Serato Markers2" — **fix del base64** (troncatura all'ultimo gruppo di 4) scoperto sui file reali; 95/96 file, 709 cue; scan cartella.
- Traktor: loop-su-pad, smartlist segnalate, fix path VOLUME boot/esterno.
- VirtualDJ: parser `.vdjfolder` + POI automix/remix.
- GUI: convertitore **X→Y** con export filtrato per sorgente.
- Schema UDM **v6** (gain/rating/track_color/beatgrid); preflight all'avvio.
- **End-to-end**: Serato reale → Traktor NML + Rekordbox XML, tutti i cue preservati.
- **176/176 test** verdi; review avversariale (7 bug corretti); build OK.

Dettaglio: `docs/IMPLEMENTAZIONE-FIX.md`, `docs/INTEROPERABILITA-DJ.md`.

## 4. Reverse engineering — cifratura / binding / SCRITTURA (nuovo)

Report completo: **`docs/REVERSE-ENGINEERING-LIBRERIE.md`**. Sintesi:

| App | Cifrata? | Chiave pubblica? | Binding | Scrittura esterna |
|---|---|---|---|---|
| Rekordbox | Sì (SQLCipher DB6) | **Sì** (`402fd…8497`, da options.json/asar) | lock processo + USN/UUID | fattibile (provata su copia) — **alto bookkeeping** |
| Serato | No | — | volume (path) | fattibile (DB V2 + GEOB nei tag) |
| Traktor | No (XML) | — | nessuno | fattibile (XML) — **facile** |
| Engine DJ | No (SQLite) | — | UUID lib, ChangeLog stub | fattibile (trigger aiutano) |
| VirtualDJ | No (XML) | — | nessuno | fattibile (XML) — **facile** |

**Conclusione**: nessun DRM hardware; l'unica cifratura (Rekordbox) usa una chiave pubblica e protegge i DATI dell'utente. La scrittura esterna di brani/playlist/cue/tag è fattibile su tutte, lavorando **su copia, ad app chiusa**, rispettando il bookkeeping (USN/UUID per Rekordbox, framing tag+len/GEOB per Serato, BLOB zlib per Engine).

**Perimetro/etica**: è interoperabilità sui dati dell'utente. NON è stato indagato né documentato alcun aggiramento di licenze/attivazione/DRM del software.

## 5. Verifica di scrittura master.db (sicurezza)

Provata in **simulazione su copia**: playlist scritta e ri-cifrata correttamente, riletta; **master.db reale intatto** (hash+mtime). pyrekordbox blocca la commit se Rekordbox è aperto. Backup del master.db in `~/Desktop/Backup MASTER DB Rekordbox/`.

## 6. Prossimi passi consigliati (roadmap scrittura)

Ordine per fattibilità/impatto (dettaglio in `docs/REVERSE-ENGINEERING-LIBRERIE.md` §5):
1. **Writer Traktor/VirtualDJ** (XML, rischio basso) — round-trip completo.
2. **Writer Engine DJ** (SQLite + BLOB) — sblocca *→Engine con cue oltre il cap 8.
3. **Writer Serato** (GEOB nei file audio) — **muta i file** → backup obbligatorio.
4. **Scrittura cue nel master.db Rekordbox** (item 11) — insert `DjmdCue` low-level con `InFrame=floor(InMsec*0.15)`, Kind non-contiguo, USN/UUID; ad app chiusa, backup.
5. **Beatgrid ANLZ** (bloccato: `ConstError` pyrekordbox su PQT2) — parser custom.

## 7. Vincoli di sicurezza rispettati

- Sessione in **modalità bypass-permessi** → auto-vincolo a operazioni **non distruttive**.
- Librerie reali **sola lettura**; scritture solo su copie in `/tmp` e nel repo.
- master.db reale **mai** aperto in scrittura.
- Handoff sicurezza/tecnico dettagliato: `docs/HANDOFF-SICUREZZA-TECNICA.md`.

## 8. Indice documenti

| File | Contenuto |
|---|---|
| `docs/INTEROPERABILITA-DJ.md` | Report interop formati (cue/playlist/backup per software) |
| `docs/IMPLEMENTAZIONE-FIX.md` | Stato roadmap fix implementati |
| `docs/CATALOGO-OPERAZIONI.md` | 146 operazioni utili per programma + roadmap |
| `docs/REVERSE-ENGINEERING-LIBRERIE.md` | Cifratura, binding, fattibilità scrittura esterna |
| `docs/HANDOFF-SICUREZZA-TECNICA.md` | Postura di sicurezza, rischi, scelte tecniche |
| `.ai-state/HANDOFF.md` | Questo indice di handoff |
