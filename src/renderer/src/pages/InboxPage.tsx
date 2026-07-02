import { useEffect, useState } from 'react';
import { FolderSync, FileX2, PackageOpen, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox, Switch } from '@/components/ui/misc';
import { PathField } from '@/pages/BackupPage';

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
          setError('Scegli prima la cartella da sorvegliare.');
          return;
        }
        const r = await window.crateforge.watcher.start(folder);
        setMessage(`Sorveglianza attiva. Primo giro: ${r.added} nuovi file trovati.`);
      } else {
        await window.crateforge.watcher.stop();
        setMessage('Sorveglianza fermata.');
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
        `XML pronto con ${r.written} brani (playlist "CrateForge – Nuovi Acquisti"). ` +
          (r.excludedForIssues > 0
            ? `${r.excludedForIssues} esclusi per tag illeggibili. `
            : '') +
          'In Rekordbox: File → Import → Import Collection, poi trascina la playlist.'
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
    setMessage(`${selected.size} elementi scartati dalla coda (i file restano dove sono).`);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuovi Acquisti</h1>
        <p className="text-sm text-muted-foreground">
          Sorveglia una cartella e prepara i nuovi brani per l'import in Rekordbox.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Come funziona (e cosa NON fa)</AlertTitle>
        <AlertDescription>
          La sorveglianza è attiva solo mentre CrateForge è aperto. I nuovi file vengono
          analizzati e messi in questa coda: nulla viene aggiunto a Rekordbox da solo. Quando
          decidi tu, generi un XML e lo importi a mano — il database di Rekordbox non viene mai
          toccato.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Cartella sorvegliata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField
            label="Cartella 'Nuovi Acquisti'"
            value={folder}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setFolder(d);
            }}
          />
          <div className="flex items-center gap-3">
            <Switch checked={running} onCheckedChange={toggleDaemon} disabled={busy || (!folder && !running)} />
            <span className="text-sm">{running ? 'Sorveglianza attiva' : 'Sorveglianza spenta'}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!folder || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await window.crateforge.watcher.scan(folder);
                  setMessage(`Scansione: ${r.scanned} file visti, ${r.added} nuovi in coda.`);
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw /> Scansiona ora
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In coda: {items.length}</CardTitle>
          <CardDescription>
            I brani con tag illeggibili sono esclusi dall'XML (vista "Da revisionare" dopo
            l'import della libreria).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun nuovo brano in coda. Compra qualcosa! 🎧
            </p>
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
                  <PackageOpen /> Prepara XML import ({selected.size})
                </Button>
                <Button variant="outline" onClick={doDismiss} disabled={selected.size === 0 || busy}>
                  <FileX2 /> Scarta dalla coda
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {message && (
        <Alert>
          <FolderSync className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
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
