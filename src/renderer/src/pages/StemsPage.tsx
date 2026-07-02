import { useState } from 'react';
import { AudioLines, Search, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { PathField } from '@/pages/BackupPage';

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
}

/**
 * Stems via Demucs (§6 Fase 2.5, Esperto, on-demand). Operazione LUNGA e
 * pesante, cancellabile. Gli stem finiscono in una cartella scelta dall'utente:
 * l'audio originale non viene toccato.
 */
export function StemsPage() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TrackRow[]>([]);
  const [track, setTrack] = useState<TrackRow | null>(null);
  const [outDir, setOutDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    const r = await window.crateforge.library.page({ offset: 0, limit: 20, search });
    setResults(r.rows);
  };

  const doRun = async () => {
    if (!track || !outDir) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const r = await window.crateforge.stems.run(track.id, outDir);
      if (!r.ok) setError(r.message ?? 'Separazione non riuscita.');
      else
        setOutcome(
          `Stem creati in ${outDir}. L'originale non è stato toccato; gli stem sono file nuovi.`
        );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stems (Demucs)</h1>
        <p className="text-sm text-muted-foreground">
          Separa voce, batteria, basso e altro in file distinti.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Operazione lunga e pesante (modalità Esperto)</AlertTitle>
        <AlertDescription>
          Richiede il livello AI del sidecar con Demucs installato (vedi{' '}
          <code>requirements-ai.txt</code>). Su un portatile senza GPU un brano può richiedere
          diversi minuti e usare molta CPU/RAM. Puoi annullare in qualsiasi momento.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Scegli brano e cartella di destinazione</CardTitle>
          <CardDescription>Gli stem sono file nuovi: nessuna modifica all'originale.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per titolo o artista…"
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            />
            <Button variant="outline" onClick={doSearch}>
              <Search /> Cerca
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {results.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTrack(t)}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted ${
                    track?.id === t.id ? 'bg-muted font-semibold' : ''
                  }`}
                >
                  {t.artist ?? '?'} – {t.title ?? '?'}
                </button>
              ))}
            </div>
          )}
          <PathField
            label="Cartella di destinazione stem"
            value={outDir}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setOutDir(d);
            }}
          />
          <div className="flex gap-2">
            <Button onClick={doRun} disabled={!track || !outDir || busy}>
              <AudioLines /> Separa stem{track ? ` di "${track.title ?? '?'}"` : ''}
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => window.crateforge.jobs.cancel()}>
                <XCircle /> Annulla
              </Button>
            )}
          </div>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

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
    </div>
  );
}
