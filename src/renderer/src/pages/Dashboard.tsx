import { useEffect, useState } from 'react';
import { Database, FileWarning, FolderOpen, Import, Music2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);

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
        text: `Importazione completata: ${r.tracks} brani, ${r.playlists} playlist, ${r.cues} cue.`
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'error', text: `Importazione non riuscita: ${String(err)}` });
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
        setMessage({ kind: 'info', text: 'Libreria letta correttamente dal database Rekordbox.' });
      } else {
        setMessage({ kind: 'warn', text: r.message });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Panoramica</h1>
        <p className="text-sm text-muted-foreground">
          CrateForge è il meccanico della tua libreria: sistemi qui, poi suoni in Rekordbox.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Music2 />} label="Brani" value={stats?.tracks ?? '—'} />
        <StatCard icon={<FolderOpen />} label="Playlist" value={stats?.playlists ?? '—'} />
        <StatCard icon={<FileWarning />} label="Da revisionare" value={stats?.needsReview ?? '—'} />
      </div>

      {sidecarOk === false && (
        <Alert variant="warning">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Modalità solo-XML attiva</AlertTitle>
          <AlertDescription>
            Il modulo di lettura diretta del database Rekordbox non è disponibile su questo
            computer (su Windows capita che l'antivirus lo metta in quarantena: controlla le
            notifiche di Windows Defender e ripristina il file, oppure aggiungi la cartella
            dell'app alle esclusioni). Puoi comunque fare tutto esportando la collection in XML
            da Rekordbox: <b>File → Export Collection in xml format</b>, poi importala qui sotto.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Importa la tua libreria</CardTitle>
          <CardDescription>
            La libreria viene copiata nel database interno di CrateForge. I file di Rekordbox
            vengono aperti in sola lettura: nessuna modifica agli originali, mai.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button onClick={importXml} disabled={busy}>
              <Import /> Importa collection XML
            </Button>
            <Button onClick={importMasterDb} disabled={busy || sidecarOk === false} variant="secondary">
              <Database /> Leggi master.db direttamente
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
              Ultima importazione: {stats.lastIngest.source} ({stats.lastIngest.status}
              {stats.lastIngest.finished_at ? `, ${stats.lastIngest.finished_at}` : ''})
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="text-muted-foreground [&_svg]:h-8 [&_svg]:w-8">{icon}</div>
        <div>
          <div className="text-2xl font-semibold">{typeof value === 'number' ? value.toLocaleString('it-IT') : value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
