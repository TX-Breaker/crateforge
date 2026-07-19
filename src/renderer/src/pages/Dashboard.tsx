import { useEffect, useState } from 'react';
import { BookOpen, Database, FileWarning, FolderOpen, Import, Music2, RefreshCw, Shuffle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { GuideDialog } from '@/components/GuideDialog';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface Stats {
  tracks: number;
  playlists: number;
  needsReview: number;
  lastIngest?: { source: string; finished_at: string | null; status: string } | null;
}

interface RekordboxPaths {
  dir: string;
  masterDb: string;
  masterDbExists: boolean;
  optionsJson: string;
  optionsJsonExists: boolean;
}

interface PreflightState {
  checkedAt: string;
  sidecar: { available: boolean; runs: boolean; binaryPath?: string; reason?: string };
  key: { ready: boolean; downloaded: boolean; message?: string };
  os: { platform: string; release: string; changed: boolean };
  ok: boolean;
}

/**
 * Panoramica + import libreria. Due strade:
 *  1) lettura diretta master.db via sidecar (se disponibile);
 *  2) modalità solo-XML (sempre disponibile, pure-Node).
 * Il master.db di Rekordbox viene rilevato automaticamente al percorso standard
 * dell'utente, così la lettura diretta parte con un clic.
 */
export function Dashboard() {
  const { locale } = useAppState();
  const tp = (key: string, p?: Record<string, string | number>) => pageText(locale, 'dashboard', key, p);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [rbPaths, setRbPaths] = useState<RekordboxPaths | null>(null);
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [pfBusy, setPfBusy] = useState(false);

  const refresh = async () => {
    setStats(await window.crateforge.library.stats());
    const check = await window.crateforge.sidecar.check();
    setSidecarOk(check.available);
  };
  useEffect(() => {
    refresh();
    window.crateforge.rekordbox.defaultPaths().then(setRbPaths);
    window.crateforge.preflight.get().then((s) => setPreflight((s as PreflightState) ?? null));
    // Il preflight può finire dopo il mount (scarico chiave): resta in ascolto.
    const off = window.crateforge.preflight.onUpdate((s) => setPreflight(s as PreflightState));
    return off;
  }, []);

  const rerunPreflight = async () => {
    setPfBusy(true);
    try {
      setPreflight((await window.crateforge.preflight.rerun()) as PreflightState);
    } finally {
      setPfBusy(false);
    }
  };

  const importXml = async () => {
    const path = await window.crateforge.dialog.openFile([
      { name: 'Rekordbox collection XML', extensions: ['xml'] }
    ]);
    if (!path) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await window.crateforge.library.ingestXml(path);
      setMessage({
        kind: 'info',
        text: tp('xmlOk', { tracks: r.tracks, playlists: r.playlists, cues: r.cues })
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'error', text: tp('foreignErr', { msg: String(err) }) });
    } finally {
      setBusy(false);
    }
  };

  const importForeign = async (kind: 'traktor' | 'virtualdj' | 'engine') => {
    const filter =
      kind === 'traktor'
        ? { name: 'Traktor collection', extensions: ['nml'] }
        : kind === 'engine'
          ? { name: 'Engine Library', extensions: ['db'] }
          : { name: 'VirtualDJ database', extensions: ['xml'] };
    const path = await window.crateforge.dialog.openFile([filter]);
    if (!path) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await window.crateforge.library.importForeign(kind, path);
      if (r.ok) {
        setMessage({
          kind: 'info',
          text:
            pageText(locale, 'dashboard', 'foreignOk', {
              tracks: r.tracks,
              playlists: r.playlists,
              cues: r.cues
            }) + (r.warnings?.length ? ` ${r.warnings.join(' ')}` : '')
        });
      } else {
        setMessage({ kind: 'error', text: pageText(locale, 'dashboard', 'foreignErr', { msg: r.message }) });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // explicitPath: percorso già noto (master.db rilevato) → nessun dialog.
  // Altrimenti apre il picker pre-puntato sulla cartella Rekordbox dell'utente.
  const importMasterDb = async (explicitPath?: string) => {
    const dbPath =
      explicitPath ??
      (await window.crateforge.dialog.openFile(
        [{ name: 'Database Rekordbox', extensions: ['db'] }],
        rbPaths?.masterDbExists ? rbPaths.masterDb : rbPaths?.dir
      ));
    if (!dbPath) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await window.crateforge.library.ingestMasterdb(dbPath);
      if (r.ok) {
        setMessage({ kind: 'info', text: tp('masterOk') });
      } else {
        setMessage({ kind: 'warn', text: r.message });
      }
      await refresh();
    } catch (err) {
      // Senza questo catch un errore IPC lasciava la barra ferma e nessun messaggio.
      setMessage({ kind: 'error', text: pageText(locale, 'dashboard', 'foreignErr', { msg: String(err) }) });
    } finally {
      setBusy(false);
    }
  };

  const masterDetected = !!rbPaths?.masterDbExists;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Music2 />} label={tp('statTracks')} value={stats?.tracks ?? '—'} />
        <StatCard icon={<FolderOpen />} label={tp('statPlaylists')} value={stats?.playlists ?? '—'} />
        <StatCard icon={<FileWarning />} label={tp('statReview')} value={stats?.needsReview ?? '—'} />
      </div>

      <PreflightBanner
        pf={preflight}
        busy={pfBusy}
        onRetry={rerunPreflight}
        t={(k) => tp(k)}
      />

      {sidecarOk === false && (
        <Alert variant="warning">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>{tp('xmlOnlyTitle')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{tp('xmlOnlyBody')}</p>
            <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openExport')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tp('importTitle')}</CardTitle>
          <CardDescription>{tp('importDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={importXml} disabled={busy}>
              <Import /> {tp('importXmlBtn')}
            </Button>
            <Button
              onClick={() => importMasterDb(masterDetected ? rbPaths!.masterDb : undefined)}
              disabled={busy || sidecarOk === false}
              variant="secondary"
            >
              <Database /> {masterDetected ? tp('importDbDetected') : tp('importDbBtn')}
            </Button>
            <Button variant="ghost" onClick={() => setGuideOpen(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openExport')}
            </Button>
          </div>
          {masterDetected && (
            <p className="text-xs text-muted-foreground">
              {tp('masterDetectedAt', { path: rbPaths!.masterDb })}{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                onClick={() => importMasterDb()}
                disabled={busy || sidecarOk === false}
              >
                {tp('chooseOtherDb')}
              </button>
            </p>
          )}
          <JobProgressBar active={busy} />
          {message && (
            <Alert variant={message.kind === 'error' ? 'destructive' : message.kind === 'warn' ? 'warning' : 'default'}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}
          {stats?.lastIngest && (
            <p className="text-xs text-muted-foreground">
              {tp('lastIngest')}: {stats.lastIngest.source} ({stats.lastIngest.status}
              {stats.lastIngest.finished_at ? `, ${stats.lastIngest.finished_at}` : ''})
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="h-4 w-4" /> {tp('foreignTitle')}
          </CardTitle>
          <CardDescription>{tp('foreignDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => importForeign('traktor')} disabled={busy}>
              <Import /> {tp('foreignTraktor')}
            </Button>
            <Button variant="secondary" onClick={() => importForeign('virtualdj')} disabled={busy}>
              <Import /> {tp('foreignVirtualdj')}
            </Button>
            <Button variant="secondary" onClick={() => importForeign('engine')} disabled={busy}>
              <Import /> {tp('foreignEngine')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <GuideDialog kind="exportXml" open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

/**
 * Banner del preflight: appare solo se qualcosa NON è pronto (modulo di lettura
 * non avviabile, o chiave del master.db non ancora scaricata). Ad app in ordine
 * non mostra nulla, per non fare rumore.
 */
function PreflightBanner({
  pf,
  busy,
  onRetry,
  t
}: {
  pf: PreflightState | null;
  busy: boolean;
  onRetry: () => void;
  t: (k: string) => string;
}) {
  if (!pf || pf.ok) return null;
  // Sidecar assente è già coperto dall'alert "solo-XML": qui evitiamo doppioni.
  if (!pf.sidecar.available) return null;

  const sidecarBroken = pf.sidecar.available && !pf.sidecar.runs;
  const keyMissing = pf.sidecar.runs && !pf.key.ready;

  return (
    <Alert variant={sidecarBroken ? 'destructive' : 'warning'}>
      <FileWarning className="h-4 w-4" />
      <AlertTitle>{t('pfTitle')}</AlertTitle>
      <AlertDescription className="space-y-2">
        {sidecarBroken && <p>{pf.os.changed ? t('pfSidecarOsChanged') : t('pfSidecarBroken')}</p>}
        {keyMissing && (
          <p>
            {t('pfKeyMissing')}
            {pf.key.message ? ` (${pf.key.message})` : ''}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={onRetry} disabled={busy}>
          <RefreshCw /> {t('pfRetry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="text-muted-foreground [&_svg]:h-8 [&_svg]:w-8">{icon}</div>
        <div>
          <div className="text-2xl font-semibold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
