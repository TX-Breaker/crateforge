import { useState } from 'react';
import { FileSearch, MapPin } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
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

      <JobProgressBar active={busy} />
      {outcome && (
        <Alert>
          <AlertDescription>{outcome}</AlertDescription>
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
