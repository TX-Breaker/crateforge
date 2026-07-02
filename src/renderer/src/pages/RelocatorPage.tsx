import { useState } from 'react';
import { FileSearch, Fingerprint, MapPin } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { PathField } from '@/pages/BackupPage';

interface BrokenRow {
  trackId: number;
  title: string | null;
  artist: string | null;
  oldPath: string;
}

interface MatchSummary {
  broken: number;
  matched: number;
  ambiguous: number;
  written: number;
}

/**
 * Relocator Esterno base (§6 Fase 1.5), modalità Esperto. Flusso: trova path
 * rotti → scegli nuova cartella → dry-run (solo conteggi) → genera XML di
 * aggiornamento da re-importare in Rekordbox. Mai scritture nel master.db.
 */
export function RelocatorPage() {
  const [broken, setBroken] = useState<BrokenRow[] | null>(null);
  const [newRoot, setNewRoot] = useState('');
  const [dryRun, setDryRun] = useState<MatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findBroken = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setDryRun(null);
    try {
      setBroken(await window.crateforge.relocator.findBroken());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDryRun = async () => {
    setBusy(true);
    setError(null);
    try {
      setDryRun(await window.crateforge.relocator.matchAndWrite(newRoot, null));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.relocator.matchAndWrite(newRoot, outPath);
      setOutcome(
        `XML di aggiornamento scritto (${r.written} brani ritrovati) in ${outPath}. ` +
          "Ora importalo in Rekordbox: Preferenze → Avanzate → rekordbox xml, poi 'Import to Collection'. " +
          'Il tuo master.db non è stato toccato.'
      );
      setDryRun(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ritrova file spostati</h1>
        <p className="text-sm text-muted-foreground">
          Se hai spostato la musica in un'altra cartella o disco, qui ricolleghi i brani "rotti".
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Funzione avanzata (modalità Esperto)</AlertTitle>
        <AlertDescription>
          Il matching avviene per nome file: se un file è stato anche rinominato, questa versione
          non lo ritrova (il matching per impronta acustica arriva in una fase futura). Il
          risultato è un XML da importare a mano in Rekordbox: CrateForge non scrive mai nel
          database originale.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Trova i brani con percorso rotto</CardTitle>
          <CardDescription>Controlla quali file della libreria non esistono più sul disco.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={findBroken} disabled={busy}>
            <FileSearch /> Cerca percorsi rotti
          </Button>
          {broken && (
            <p className="text-sm">
              Brani con percorso rotto: <b>{broken.length.toLocaleString('it-IT')}</b>
            </p>
          )}
          {broken && broken.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border p-2 text-xs text-muted-foreground">
              {broken.slice(0, 200).map((b) => (
                <div key={b.trackId} className="truncate">
                  {b.artist ?? '?'} – {b.title ?? '?'} <span className="opacity-60">({b.oldPath})</span>
                </div>
              ))}
              {broken.length > 200 && <div>… e altri {broken.length - 200}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {broken && broken.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Dove si trovano adesso i file?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PathField
              label="Nuova cartella musica"
              value={newRoot}
              onBrowse={async () => {
                const d = await window.crateforge.dialog.openDirectory();
                if (d) setNewRoot(d);
              }}
            />
            <Button onClick={doDryRun} disabled={!newRoot || busy}>
              Anteprima (nessun file scritto)
            </Button>
            {dryRun && (
              <Alert>
                <AlertDescription>
                  Su {dryRun.broken} brani rotti: <b>{dryRun.matched} ritrovati</b> per nome file,{' '}
                  {dryRun.ambiguous} con più candidati (verrà usato il primo trovato),{' '}
                  {dryRun.broken - dryRun.matched} non trovati.
                </AlertDescription>
              </Alert>
            )}
            {dryRun && dryRun.matched > 0 && (
              <Button onClick={doWrite} disabled={busy}>
                <MapPin /> Genera XML di aggiornamento…
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <FingerprintRelocator
        newRoot={newRoot}
        setBusy={setBusy}
        setError={setError}
        setOutcome={setOutcome}
        busy={busy}
      />

      <JobProgressBar active={busy} />
      {outcome && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{outcome}</p>
            <SaveTargetNotice target="xml" />
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Relocator per fingerprint (§6 Fase 2.3): ritrova i file anche se RINOMINATI,
 * confrontando l'impronta acustica. Richiede di aver già calcolato le impronte
 * (pagina "Duplicati (impronta)") quando i file erano ancora al loro posto.
 */
function FingerprintRelocator({
  newRoot,
  busy,
  setBusy,
  setError,
  setOutcome
}: {
  newRoot: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  setOutcome: (v: string | null) => void;
}) {
  const [fpSummary, setFpSummary] = useState<{ broken: number; matched: number; scanned: number } | null>(null);

  const doMatch = async () => {
    setBusy(true);
    setError(null);
    setFpSummary(null);
    try {
      const r = await window.crateforge.relocatorFp.match(newRoot);
      if (!r.ok) setError(r.message);
      else setFpSummary(r as { broken: number; matched: number; scanned: number });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation-fp.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    try {
      const r = await window.crateforge.relocatorFp.writeXml(outPath);
      setOutcome(
        `XML scritto (${r.written} brani ritrovati per impronta) in ${outPath}. ` +
          'Importalo a mano in Rekordbox. Il master.db non è stato toccato.'
      );
      setFpSummary(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4" /> Extra · Matching per impronta acustica
          (sperimentale)
        </CardTitle>
        <CardDescription>
          Ritrova i file anche se sono stati RINOMINATI. Funziona solo per i brani di cui hai già
          calcolato l'impronta (pagina "Duplicati") prima di spostarli; fingerprinta tutti i file
          della nuova cartella, quindi può richiedere parecchi minuti.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={doMatch} disabled={!newRoot || busy} variant="secondary">
          Cerca per impronta nella nuova cartella
        </Button>
        {fpSummary && (
          <>
            <Alert>
              <AlertDescription>
                File scansionati: {fpSummary.scanned} — brani rotti con impronta:{' '}
                {fpSummary.broken} — <b>ritrovati: {fpSummary.matched}</b>.
              </AlertDescription>
            </Alert>
            {fpSummary.matched > 0 && (
              <Button onClick={doWrite} disabled={busy}>
                <MapPin /> Genera XML di aggiornamento…
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
