import { useState } from 'react';
import { AudioLines, Search, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { PathField } from '@/pages/BackupPage';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

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
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'stems', k, p);
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
      if (!r.ok) setError(r.message ?? tp('errDefault'));
      else setOutcome(tp('outDone', { dir: outDir }));
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

      <Alert variant="warning">
        <AlertTitle>{tp('warnTitle')}</AlertTitle>
        <AlertDescription>{tp('warnBody')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{tp('cardTitle')}</CardTitle>
          <CardDescription>{tp('cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tp('searchPh')}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            />
            <Button variant="outline" onClick={doSearch}>
              <Search /> {tp('searchBtn')}
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
            label={tp('fOutDir')}
            value={outDir}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setOutDir(d);
            }}
          />
          <div className="flex gap-2">
            <Button onClick={doRun} disabled={!track || !outDir || busy}>
              <AudioLines /> {tp('runBtn')}{track ? ` — "${track.title ?? '?'}"` : ''}
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => window.crateforge.jobs.cancel()}>
                <XCircle /> {tp('cancelBtn')}
              </Button>
            )}
          </div>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

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
    </div>
  );
}
