import { useMemo, useState } from 'react';
import { CopyX, Fingerprint } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox } from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { PathField } from '@/pages/BackupPage';
import { formatBytes } from '@/lib/utils';

interface DupTrack {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
  filesize: number | null;
  duration_s: number | null;
}

interface DupGroup {
  acousticId: string;
  tracks: DupTrack[];
}

/**
 * Dedup per fingerprint acustico (§6 Fase 2.2, Esperto, sperimentale).
 * fpcalc/Chromaprint calcola l'impronta; brani con lo stesso Acoustic ID sono
 * con alta probabilità lo stesso audio anche con nomi file diversi.
 * I duplicati selezionati vanno in QUARANTENA (reversibile), mai eliminati.
 */
export function DedupPage() {
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quarantineDir, setQuarantineDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBytes = useMemo(() => {
    let sum = 0;
    for (const g of groups ?? [])
      for (const t of g.tracks) if (t.path && selected.has(t.path)) sum += t.filesize ?? 0;
    return sum;
  }, [groups, selected]);

  const doRun = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setGroups(null);
    setSelected(new Set());
    try {
      const r = await window.crateforge.dedup.run();
      if (!r.ok) {
        setError(r.message);
      } else {
        setGroups(r.groups);
        const s = r.stats as { fingerprinted?: number; failed?: number; skippedMissing?: number };
        setStats(
          `Impronte calcolate: ${s.fingerprinted ?? 0} (fallite: ${s.failed ?? 0}, file mancanti: ${s.skippedMissing ?? 0}).`
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const doQuarantine = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await window.crateforge.orphans.quarantine(files, quarantineDir, false);
      setOutcome(
        `Spostati in quarantena ${r.moved} duplicati (cartella: ${r.quarantineDir}). ` +
          'Ricorda: la libreria Rekordbox punta ancora ai vecchi path; dopo la pulizia ' +
          "usa 'Ritrova file spostati' o sistema la collection."
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
        <h1 className="text-2xl font-semibold tracking-tight">Duplicati per impronta acustica</h1>
        <p className="text-sm text-muted-foreground">
          Trova i doppioni veri — stesso audio, anche con nome file diverso.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Funzione sperimentale (modalità Esperto)</AlertTitle>
        <AlertDescription>
          L'impronta acustica (Chromaprint, inclusa in CrateForge: niente da installare)
          riconosce lo stesso audio con encoding diversi nella maggior parte dei casi, ma non è
          infallibile: controlla sempre i gruppi prima di agire. Richiede una scansione completa
          dei file: su librerie grandi può durare parecchi minuti.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Calcola le impronte e trova i duplicati</CardTitle>
          <CardDescription>
            L'Acoustic ID compare anche come colonna nel Report Excel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={doRun} disabled={busy}>
            <Fingerprint /> Avvia analisi
          </Button>
          <JobProgressBar active={busy} />
          {stats && <p className="text-xs text-muted-foreground">{stats}</p>}
        </CardContent>
      </Card>

      {groups && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Gruppi di duplicati: {groups.length}</CardTitle>
            <CardDescription>
              Spunta le copie da mettere in quarantena (tieni almeno un file per gruppo!).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessun duplicato acustico trovato. Libreria pulita.
              </p>
            ) : (
              <>
                <div className="max-h-96 space-y-3 overflow-auto">
                  {groups.map((g) => (
                    <div key={g.acousticId} className="rounded-md border p-2">
                      <div className="mb-1 font-mono text-[10px] text-muted-foreground">
                        {g.acousticId}
                      </div>
                      {g.tracks.map((t) => (
                        <label
                          key={t.id}
                          className="flex cursor-pointer items-center gap-2 py-0.5 text-xs"
                        >
                          <Checkbox
                            checked={t.path !== null && selected.has(t.path)}
                            disabled={t.path === null}
                            onCheckedChange={() => t.path && toggle(t.path)}
                          />
                          <span className="flex-1 truncate">
                            {t.artist ?? '?'} – {t.title ?? '?'}{' '}
                            <span className="text-muted-foreground">({t.path ?? 'senza file'})</span>
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {t.filesize !== null ? formatBytes(t.filesize) : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="space-y-3 border-t pt-3">
                  <PathField
                    label="Cartella di quarantena"
                    value={quarantineDir}
                    onBrowse={async () => {
                      const d = await window.crateforge.dialog.openDirectory();
                      if (d) setQuarantineDir(d);
                    }}
                  />
                  <Button
                    variant="destructive"
                    disabled={selected.size === 0 || !quarantineDir || busy}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <CopyX /> Sposta in quarantena ({selected.size}, {formatBytes(selectedBytes)})
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {outcome && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{outcome}</p>
            <SaveTargetNotice target="copy" />
          </AlertDescription>
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
        title="Mettere i duplicati in quarantena?"
        confirmWord="SPOSTA"
        confirmLabel={`Sposta ${selected.size} file`}
        onConfirm={doQuarantine}
        description={
          <>
            <p>
              {selected.size.toLocaleString('it-IT')} file ({formatBytes(selectedBytes)}) verranno
              spostati (non eliminati) in:
            </p>
            <p className="font-mono text-xs">{quarantineDir}</p>
            <p>Verifica di aver lasciato almeno una copia per ogni gruppo.</p>
          </>
        }
      />
    </div>
  );
}
