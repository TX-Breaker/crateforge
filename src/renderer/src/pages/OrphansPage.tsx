import { useEffect, useMemo, useState } from 'react';
import { FileWarning, FolderSearch, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox } from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { JobProgressBar } from '@/components/JobProgress';
import { PathField } from '@/pages/BackupPage';
import { formatBytes } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

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
 * L'eliminazione definitiva esiste solo con le "scritture dirette" (opt-in).
 */
export function OrphansPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'orphans', k, p);
  const tc = (k: string, p?: Record<string, string | number>) => pageText(locale, 'common', k, p);
  const [musicDir, setMusicDir] = useState('');
  const [quarantineDir, setQuarantineDir] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [directWrites, setDirectWrites] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
  }, []);

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

  const removeFromList = (files: string[], failed: { path: string }[]) => {
    const failedSet = new Set(failed.map((f) => f.path));
    const moved = new Set(files.filter((f) => !failedSet.has(f)));
    setResult((prev) =>
      prev ? { ...prev, orphans: prev.orphans.filter((o) => !moved.has(o.path)) } : prev
    );
    setSelected(new Set());
  };

  const doQuarantine = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await window.crateforge.orphans.quarantine(files, quarantineDir, false);
      setOutcome(
        tp('outMoved', { moved: r.moved, tot: files.length, dir: r.quarantineDir }) +
          (r.failed.length ? tp('outMovedFail', { n: r.failed.length }) : '') +
          tp('outMovedTail')
      );
      removeFromList(files, r.failed);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await window.crateforge.orphans.remove(files, false);
      setOutcome(
        tp('outDeleted', { n: r.deleted, size: formatBytes(r.freedBytes) }) +
          (r.failed.length ? tp('outDelFail', { n: r.failed.length }) : '')
      );
      removeFromList(files, r.failed);
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

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{tp('howTitle')}</AlertTitle>
        <AlertDescription>{tp('howBody')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{tp('step1')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label={tp('fMusic')} value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
          <Button onClick={doScan} disabled={!musicDir || busy}>
            <FolderSearch /> {tp('scan')}
          </Button>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>{tp('step2')}</CardTitle>
            <CardDescription>
              {tp('resLine', {
                scanned: result.scannedFiles.toLocaleString(locale),
                known: result.knownTracks.toLocaleString(locale),
                orphans: result.orphans.length.toLocaleString(locale),
                space: formatBytes(result.reclaimableBytes)
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.orphans.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tp('none')}</p>
            ) : (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    {tc('selectAll')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                    {tc('deselectAll')}
                  </Button>
                  <span className="text-muted-foreground">
                    {tp('selCount', {
                      n: selected.size.toLocaleString(locale),
                      size: formatBytes(selectedBytes)
                    })}
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
                      {tc('prev')}
                    </Button>
                    {tc('pageOf', { p: page + 1, tot: Math.ceil(result.orphans.length / PAGE_SIZE) })}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(page + 1) * PAGE_SIZE >= result.orphans.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {tc('next')}
                    </Button>
                  </div>
                )}
                <div className="space-y-3 border-t pt-3">
                  <PathField
                    label={tp('fQuarantine')}
                    value={quarantineDir}
                    onBrowse={() => pickDir(setQuarantineDir)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      disabled={selected.size === 0 || !quarantineDir || busy}
                      onClick={() => setConfirmOpen(true)}
                    >
                      <FileWarning /> {tp('moveBtn', { n: selected.size })}
                    </Button>
                    {directWrites && (
                      <Button
                        variant="destructive"
                        disabled={selected.size === 0 || busy}
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 /> {tp('delBtn', { n: selected.size })}
                      </Button>
                    )}
                  </div>
                  {directWrites && (
                    <p className="text-xs text-muted-foreground">{tp('directNote')}</p>
                  )}
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
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tp('delTitle')}
        confirmWord="ELIMINA"
        confirmLabel={tp('delLabel', { n: selected.size })}
        onConfirm={doDelete}
        description={
          <>
            <p>
              {tp('delBody1', {
                n: selected.size.toLocaleString(locale),
                size: formatBytes(selectedBytes)
              })}
            </p>
            <p>{tp('delBody2')}</p>
          </>
        }
      />

      <DangerConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={tp('qTitle')}
        confirmWord="SPOSTA"
        confirmLabel={tp('qLabel', { n: selected.size })}
        onConfirm={doQuarantine}
        description={
          <>
            <p>
              {tp('qBody1', {
                n: selected.size.toLocaleString(locale),
                size: formatBytes(selectedBytes)
              })}
            </p>
            <p className="font-mono text-xs">{quarantineDir}</p>
            <p>{tp('qBody2')}</p>
          </>
        }
      />
    </div>
  );
}
