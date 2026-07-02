import { useState } from 'react';
import { HardDriveDownload, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { formatBytes } from '@/lib/utils';

interface PlanSummary {
  planId: string;
  scannedFiles: number;
  toCopy: number;
  totalBytes: number;
  dbSnapshotDir: string | null;
  preview: { src: string; reason: string }[];
}

/**
 * Wizard Backup Smart Incrementale: scegli cartelle → anteprima (dry-run) →
 * esegui. Il DB Rekordbox viene sempre copiato per primo (§3.2).
 */
export function BackupPage() {
  const [musicDir, setMusicDir] = useState('');
  const [backupDir, setBackupDir] = useState('');
  const [masterDb, setMasterDb] = useState('');
  const [optionsJson, setOptionsJson] = useState('');
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickDir = async (setter: (v: string) => void) => {
    const d = await window.crateforge.dialog.openDirectory();
    if (d) setter(d);
  };
  const pickFile = async (setter: (v: string) => void, name: string, ext: string[]) => {
    const f = await window.crateforge.dialog.openFile([{ name, extensions: ext }]);
    if (f) setter(f);
  };

  const doPlan = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const p = await window.crateforge.backup.plan({
        musicDir,
        backupDir,
        masterDbPath: masterDb || undefined,
        optionsJsonPath: optionsJson || undefined
      });
      setPlan(p);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doExecute = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.backup.execute(plan.planId);
      setResult(
        `Backup completato: ${r.copied} file copiati` +
          (r.dbSnapshotDir ? `. Database salvato in ${r.dbSnapshotDir}` : '') +
          (r.failed.length ? `. ATTENZIONE: ${r.failed.length} file non copiati.` : '')
      );
      setPlan(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backup Smart Incrementale</h1>
        <p className="text-sm text-muted-foreground">
          Copia il database di Rekordbox e solo i file musicali nuovi o modificati. Secondi, non ore.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Operazione sicura</AlertTitle>
        <AlertDescription>
          Il backup legge soltanto: i tuoi originali non vengono modificati né spostati.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Scegli le cartelle</CardTitle>
          <CardDescription>
            Consiglio: seleziona anche master.db e options.json — options.json serve per poter
            rileggere il database in futuro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label="Cartella musica" value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
          <PathField label="Cartella di backup (destinazione)" value={backupDir} onBrowse={() => pickDir(setBackupDir)} />
          <PathField
            label="master.db (opzionale ma consigliato)"
            value={masterDb}
            onBrowse={() => pickFile(setMasterDb, 'master.db', ['db'])}
          />
          <PathField
            label="options.json (opzionale ma consigliato)"
            value={optionsJson}
            onBrowse={() => pickFile(setOptionsJson, 'options.json', ['json'])}
          />
          <Button onClick={doPlan} disabled={!musicDir || !backupDir || busy}>
            Calcola anteprima
          </Button>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Anteprima (nessun file toccato finora)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Scansionati <b>{plan.scannedFiles.toLocaleString('it-IT')}</b> file. Da copiare:{' '}
              <b>{plan.toCopy.toLocaleString('it-IT')}</b> ({formatBytes(plan.totalBytes)}).
              {plan.dbSnapshotDir && (
                <>
                  {' '}
                  Il database Rekordbox verrà salvato in <code className="text-xs">{plan.dbSnapshotDir}</code>.
                </>
              )}
            </p>
            {plan.preview.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-md border p-2 text-xs text-muted-foreground">
                {plan.preview.map((i) => (
                  <div key={i.src}>
                    [{i.reason === 'new' ? 'nuovo' : 'modificato'}] {i.src}
                  </div>
                ))}
                {plan.toCopy > plan.preview.length && (
                  <div>… e altri {(plan.toCopy - plan.preview.length).toLocaleString('it-IT')} file</div>
                )}
              </div>
            )}
            <Button onClick={doExecute} disabled={busy}>
              <HardDriveDownload /> Esegui il backup
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Alert>
          <AlertDescription>{result}</AlertDescription>
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

export function PathField({
  label,
  value,
  onBrowse
}: {
  label: string;
  value: string;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly placeholder="Nessun percorso selezionato" />
        <Button variant="outline" onClick={onBrowse}>
          Sfoglia…
        </Button>
      </div>
    </div>
  );
}
