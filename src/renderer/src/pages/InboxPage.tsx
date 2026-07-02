import { useEffect, useState } from 'react';
import { FolderSync, FileX2, PackageOpen, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox, Switch } from '@/components/ui/misc';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { PathField } from '@/pages/BackupPage';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface InboxItem {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  version_label: string | null;
  has_tag_issues: number;
  added_at: string;
}

/**
 * Sync Daemon "Nuovi Acquisti" (§6 Fase 3.1, Esperto).
 * Onestà tecnica: sorveglia SOLO mentre CrateForge è aperto; non inietta nulla
 * in Rekordbox — prepara un XML che l'utente importa a mano.
 */
export function InboxPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'inbox', k, p);
  const [folder, setFolder] = useState('');
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const st = await window.crateforge.watcher.status();
    setRunning(st.running);
    if (st.folder) setFolder(st.folder);
    const list = await window.crateforge.inbox.list('new');
    setItems(list);
    setSelected(new Set(list.filter((i: InboxItem) => i.has_tag_issues === 0).map((i: InboxItem) => i.id)));
  };

  useEffect(() => {
    refresh();
    const off = window.crateforge.watcher.onNewItems(() => refresh());
    return off;
  }, []);

  const toggleDaemon = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        if (!folder) {
          setError(tp('needFolder'));
          return;
        }
        const r = await window.crateforge.watcher.start(folder);
        setMessage(tp('startLine', { n: r.added }));
      } else {
        await window.crateforge.watcher.stop();
        setMessage(tp('stopLine'));
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doPrepare = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-nuovi-acquisti.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    try {
      const r = await window.crateforge.inbox.prepareXml([...selected], outPath);
      setMessage(
        tp('outPrepared', {
          n: r.written,
          excluded: r.excludedForIssues > 0 ? tp('outExcluded', { n: r.excludedForIssues }) : ''
        })
      );
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDismiss = async () => {
    await window.crateforge.inbox.setStatus([...selected], 'dismissed');
    setMessage(tp('outDismissed', { n: selected.size }));
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <Alert variant="warning">
        <AlertTitle>{tp('howTitle')}</AlertTitle>
        <AlertDescription>{tp('howBody')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{tp('folderTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField
            label={tp('fFolder')}
            value={folder}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setFolder(d);
            }}
          />
          <div className="flex items-center gap-3">
            <Switch checked={running} onCheckedChange={toggleDaemon} disabled={busy || (!folder && !running)} />
            <span className="text-sm">{running ? tp('running') : tp('stopped')}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!folder || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await window.crateforge.watcher.scan(folder);
                  setMessage(tp('scanLine', { scanned: r.scanned, added: r.added }));
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw /> {tp('scanNow')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tp('queueTitle', { n: items.length })}</CardTitle>
          <CardDescription>{tp('queueDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tp('empty')}</p>
          ) : (
            <>
              <div className="max-h-80 overflow-auto rounded-md border">
                {items.map((it) => (
                  <label
                    key={it.id}
                    className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(it.id)}
                      disabled={it.has_tag_issues === 1}
                      onCheckedChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(it.id)) next.delete(it.id);
                          else next.add(it.id);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1 truncate">
                      {it.has_tag_issues === 1 ? '⚠ ' : ''}
                      {it.artist ?? '?'} – {it.title ?? it.path.split(/[\\/]/).pop()}
                      {it.version_label && (
                        <span className="text-muted-foreground"> ({it.version_label})</span>
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {it.bpm ? `${Math.round(it.bpm)} BPM` : ''} {it.camelot ?? ''}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button onClick={doPrepare} disabled={selected.size === 0 || busy}>
                  <PackageOpen /> {tp('prepareBtn', { n: selected.size })}
                </Button>
                <Button variant="outline" onClick={doDismiss} disabled={selected.size === 0 || busy}>
                  <FileX2 /> {tp('dismissBtn')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {message && (
        <Alert>
          <FolderSync className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{message}</p>
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
