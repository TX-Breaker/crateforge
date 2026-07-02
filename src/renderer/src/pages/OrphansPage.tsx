import { useMemo, useState } from 'react';
import { FileWarning, FolderSearch, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox } from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { JobProgressBar } from '@/components/JobProgress';
import { PathField } from '@/pages/BackupPage';
import { formatBytes } from '@/lib/utils';

interface Orphan {
  path: string;
  size: number;
  mtimeMs: number;
}

interface ScanResult {
  orphans: Orphan[];
  scannedFiles: number;
  knownTracks: number;
  reclaimableBytes: number;
}

const PAGE_SIZE = 100;

/**
 * Cacciatore di File Orfani (§6 Fase 1.2). Il flusso è: scansione → selezione
 * → anteprima (dry-run) → doppia conferma → spostamento in quarantena.
 * Nessuna cancellazione definitiva: la quarantena è reversibile.
 */
export function OrphansPage() {
  const [musicDir, setMusicDir] = useState('');
  const [quarantineDir, setQuarantineDir] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageItems = useMemo(
    () => (result ? result.orphans.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : []),
    [result, page]
  );
  const selectedBytes = useMemo(() => {
    if (!result) return 0;
    let sum = 0;
    for (const o of result.orphans) if (selected.has(o.path)) sum += o.size;
    return sum;
  }, [result, selected]);

  const pickDir = async (setter: (v: string) => void) => {
    const d = await window.crateforge.dialog.openDirectory();
    if (d) setter(d);
  };

  const doScan = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setResult(null);
    setSelected(new Set());
    setPage(0);
    try {
      setResult(await window.crateforge.orphans.scan(musicDir));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    if (!result) return;
    setSelected(new Set(result.orphans.map((o) => o.path)));
  };

  const doQuarantine = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await window.crateforge.orphans.quarantine(files, quarantineDir, false);
      setOutcome(
        `Spostati in quarantena ${r.moved} file su ${files.length} (cartella: ${r.quarantineDir}).` +
          (r.failed.length ? ` ATTENZIONE: ${r.failed.length} non spostati.` : '') +
          ' Puoi ripristinarli in qualsiasi momento: nessun file è stato eliminato.'
      );
      // Togli dalla lista quelli spostati con successo
      const failedSet = new Set(r.failed.map((f: { path: string }) => f.path));
      setResult((prev) =>
        prev
          ? {
              ...prev,
              orphans: prev.orphans.filter((o) => !selected.has(o.path) || failedSet.has(o.path))
            }
          : prev
      );
      setSelected(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cacciatore di File Orfani</h1>
        <p className="text-sm text-muted-foreground">
          Trova i file audio presenti sul disco ma assenti dalla tua libreria Rekordbox.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Come funziona la quarantena</AlertTitle>
        <AlertDescription>
          CrateForge non elimina mai i file: li sposta in una cartella di quarantena datata, da cui
          puoi ripristinarli quando vuoi. La scansione confronta il disco con la libreria che hai
          importato: importa prima la libreria dalla Panoramica.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Scansiona la cartella musica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label="Cartella musica" value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
          <Button onClick={doScan} disabled={!musicDir || busy}>
            <FolderSearch /> Avvia scansione
          </Button>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Risultato</CardTitle>
            <CardDescription>
              {result.scannedFiles.toLocaleString('it-IT')} file scansionati,{' '}
              {result.knownTracks.toLocaleString('it-IT')} brani in libreria.{' '}
              <b>{result.orphans.length.toLocaleString('it-IT')} orfani</b> — spazio recuperabile:{' '}
              <b>{formatBytes(result.reclaimableBytes)}</b>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.orphans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessun file orfano: disco e libreria sono allineati. Ottimo lavoro.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Seleziona tutti
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                    Deseleziona
                  </Button>
                  <span className="text-muted-foreground">
                    {selected.size.toLocaleString('it-IT')} selezionati ({formatBytes(selectedBytes)})
                  </span>
                </div>
                <div className="max-h-72 overflow-auto rounded-md border">
                  {pageItems.map((o) => (
                    <label
                      key={o.path}
                      className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selected.has(o.path)}
                        onCheckedChange={() => toggle(o.path)}
                      />
                      <span className="flex-1 truncate">{o.path}</span>
                      <span className="shrink-0 text-muted-foreground">{formatBytes(o.size)}</span>
                    </label>
                  ))}
                </div>
                {result.orphans.length > PAGE_SIZE && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Precedenti
                    </Button>
                    Pagina {page + 1} di {Math.ceil(result.orphans.length / PAGE_SIZE)}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(page + 1) * PAGE_SIZE >= result.orphans.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Successivi →
                    </Button>
                  </div>
                )}
                <div className="space-y-3 border-t pt-3">
                  <PathField
                    label="Cartella di quarantena (dove spostare i file)"
                    value={quarantineDir}
                    onBrowse={() => pickDir(setQuarantineDir)}
                  />
                  <Button
                    variant="destructive"
                    disabled={selected.size === 0 || !quarantineDir || busy}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <FileWarning /> Sposta in quarantena ({selected.size})
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

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

      <DangerConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Spostare i file in quarantena?"
        confirmWord="SPOSTA"
        confirmLabel={`Sposta ${selected.size} file`}
        onConfirm={doQuarantine}
        description={
          <>
            <p>
              Stai per spostare <b>{selected.size.toLocaleString('it-IT')} file</b> (
              {formatBytes(selectedBytes)}) dalla cartella musica alla quarantena:
            </p>
            <p className="font-mono text-xs">{quarantineDir}</p>
            <p>
              I file NON vengono eliminati e potrai ripristinarli. Se alcuni servono ad altri
              programmi, escludili prima dalla selezione.
            </p>
          </>
        }
      />
    </div>
  );
}
