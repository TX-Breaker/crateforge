import { useEffect, useState } from 'react';
import { BookOpen, Database, FileWarning, FolderOpen, Import, Music2, Shuffle } from 'lucide-react';
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

/**
 * Panoramica + import libreria. Due strade:
 *  1) lettura diretta master.db via sidecar (se disponibile);
 *  2) modalità solo-XML (sempre disponibile, pure-Node).
 */
export function Dashboard() {
  const { locale } = useAppState();
  const tp = (key: string, p?: Record<string, string | number>) => pageText(locale, 'dashboard', key, p);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const refresh = async () => {
    setStats(await window.crateforge.library.stats());
    const check = await window.crateforge.sidecar.check();
    setSidecarOk(check.available);
  };
  useEffect(() => {
    refresh();
  }, []);

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

  const importMasterDb = async () => {
    const dbPath = await window.crateforge.dialog.openFile([
      { name: 'Database Rekordbox', extensions: ['db'] }
    ]);
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
            <Button onClick={importMasterDb} disabled={busy || sidecarOk === false} variant="secondary">
              <Database /> {tp('importDbBtn')}
            </Button>
            <Button variant="ghost" onClick={() => setGuideOpen(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openExport')}
            </Button>
          </div>
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
