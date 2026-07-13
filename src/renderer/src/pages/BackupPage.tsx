import { useState } from 'react';
import { HardDriveDownload, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { formatBytes } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { t } from '@/lib/i18n';

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
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'backup', k, p);
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
        tp('resDone', { copied: r.copied }) +
          (r.dbSnapshotDir ? tp('resDb', { dir: r.dbSnapshotDir }) : '') +
          (r.failed.length ? tp('resFail', { n: r.failed.length }) : '')
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
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <RekordboxDiff page="backup" />

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{tp('safeTitle')}</AlertTitle>
        <AlertDescription>{tp('safeBody')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label={tp('fMusic')} value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
          <PathField label={tp('fBackup')} value={backupDir} onBrowse={() => pickDir(setBackupDir)} />
          <PathField
            label={tp('fMasterDb')}
            value={masterDb}
            onBrowse={() => pickFile(setMasterDb, 'master.db', ['db'])}
          />
          <PathField
            label={tp('fOptions')}
            value={optionsJson}
            onBrowse={() => pickFile(setOptionsJson, 'options.json', ['json'])}
          />
          <Button onClick={doPlan} disabled={!musicDir || !backupDir || busy}>
            {tp('calc')}
          </Button>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle>{tp('step2')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {tp('planLine', {
                scanned: plan.scannedFiles.toLocaleString(locale),
                toCopy: plan.toCopy.toLocaleString(locale),
                size: formatBytes(plan.totalBytes)
              })}
              {plan.dbSnapshotDir && <> {tp('planDb', { dir: plan.dbSnapshotDir })}</>}
            </p>
            {plan.preview.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-md border p-2 text-xs text-muted-foreground">
                {plan.preview.map((i) => (
                  <div key={i.src}>
                    [{i.reason === 'new' ? tp('reasonNew') : tp('reasonMod')}] {i.src}
                  </div>
                ))}
                {plan.toCopy > plan.preview.length && (
                  <div>{tp('more', { n: (plan.toCopy - plan.preview.length).toLocaleString(locale) })}</div>
                )}
              </div>
            )}
            <Button onClick={doExecute} disabled={busy}>
              <HardDriveDownload /> {tp('run')}
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
  const { locale } = useAppState();
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly placeholder="—" />
        <Button variant="outline" onClick={onBrowse}>
          {t(locale, 'common.browse')}
        </Button>
      </div>
    </div>
  );
}
