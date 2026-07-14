# Build macOS di CrateForge

## Perché NON si può buildare da Windows

La versione macOS **non può essere generata su questo PC Windows**, per tre
motivi tecnici indipendenti:

1. **Sidecar PyInstaller**: PyInstaller non fa cross-compilazione — il binario
   `crateforge-sidecar` per macOS va costruito SU macOS (per ciascuna
   architettura: Apple Silicon arm64 e Intel x86_64).
2. **Moduli nativi Node**: `better-sqlite3` va ricompilato per l'ABI
   Electron/darwin (electron-builder lo fa, ma solo girando su macOS).
3. **Packaging**: il target `dmg` richiede tooling macOS (hdiutil).

Le due strade praticabili sono descritte sotto. Il codice è già pronto per
entrambe (percorsi POSIX, normalizzazione NFC dei nomi file, kill del process
group su unix, nome binario sidecar senza `.exe` su darwin: tutto già gestito).

## Strada A — GitHub Actions (consigliata: nessun Mac necessario)

Il workflow `.github/workflows/build.yml` è già configurato con una matrix a
3 runner:

| Runner | Cosa produce |
|--------|--------------|
| `macos-latest` | dmg + zip per **Apple Silicon (arm64)** |
| `macos-15-intel` | dmg + zip per **Intel (x86_64)** |
| `windows-latest` | installer NSIS + portable |

Ogni job builda anche il sidecar PyInstaller sul runner nativo (dallo `.spec`,
con il fix numpy), scarica fpcalc per l'architettura giusta (l'asset
`macos-arm64` esiste nel release chromaprint 1.5.1 — verificato), fa lo smoke
`ping` del sidecar e carica gli artifact (retention 14 giorni).

Passi necessari (una tantum):
1. Creare una repository su GitHub (pubblica = minuti CI illimitati e gratis;
   privata = i job macOS consumano quota con moltiplicatore **10x**).
2. `git remote add origin <url>` e `git push -u origin master`.
3. Il push fa partire il workflow da solo (trigger su master); in alternativa
   partenza manuale da Actions → "Build CrateForge" → Run workflow.
4. Scaricare gli artifact `crateforge-macos-latest` (arm64) e
   `crateforge-macos-15-intel` (x64) dalla pagina del run.

## Strada B — Su un Mac reale

Prerequisiti: Node 22+, Python 3.13 (o 3.11+), Xcode Command Line Tools
(`xcode-select --install`).

```bash
git clone <repo> && cd crateforge     # o copia la cartella del progetto
npm ci                                 # ricompila better-sqlite3 per darwin
bash python-sidecar/build_sidecar.sh   # sidecar PyInstaller + fpcalc (dallo .spec)
npm run dist                           # produce release/*.dmg e release/*.zip
```

Il binario prodotto vale solo per l'architettura del Mac su cui si builda
(Apple Silicon → arm64, Intel → x64).

## Avvio su macOS (build non firmati)

I build non sono firmati/notarizzati (in CI: `identity: null`,
`CSC_IDENTITY_AUTO_DISCOVERY=false`). Gatekeeper bloccherà il primo avvio:

- **macOS 15 Sequoia+**: "tasto destro → Apri" NON basta più. Aprire l'app
  (viene bloccata), poi **Impostazioni di Sistema → Privacy e Sicurezza →
  "Apri comunque"** (password admin, una sola volta).
- **macOS 13/14**: tasto destro sull'app → Apri → Apri.
- Alternativa terminale: `xattr -dr com.apple.quarantine /Applications/CrateForge.app`

Il sidecar PyInstaller è firmato ad-hoc automaticamente da PyInstaller
(obbligatorio su arm64) e funziona senza passaggi extra.

Per eliminare i warning servirebbero certificato Apple Developer +
notarizzazione (`notarize: true` in electron-builder); se in futuro si firma,
va firmato ricorsivamente anche il sidecar con la stessa identità, altrimenti
la notarizzazione fallisce.

## Note note/limiti

- `build/icon.png` è 512×512: il minimo per generare l'icns. Funziona, ma su
  display Retina l'icona risulterà leggermente morbida — quando possibile
  rigenerare a 1024×1024 dalla sorgente.
- Percorso master.db su macOS: `~/Library/Pioneer/rekordbox/master.db`
  (l'utente lo seleziona dal file picker, nessun path hardcoded nell'app).
- Auto-update non cablato (niente electron-updater): distribuzione manuale
  di dmg/zip.
