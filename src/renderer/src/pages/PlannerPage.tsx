import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ListMusic, Route } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';

interface PlannerTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface Transition {
  from: PlannerTrack;
  to: PlannerTrack;
  flags: string[];
  keyOk: boolean | null;
  bpmDelta: number | null;
  bridges: PlannerTrack[];
}

interface Analysis {
  tracks: number;
  transitions: Transition[];
  problems: number;
  missingData: number;
}

const trackLabel = (t: PlannerTrack) =>
  `${t.artist ?? '?'} – ${t.title ?? '?'}${t.camelot ? ` [${t.camelot}]` : ''}${
    t.bpm ? ` ${Math.round(t.bpm)}bpm` : ''
  }`;

/**
 * Set Planner (§6 Fase 3.2, Esperto, read-only). Analizza le transizioni di
 * una playlist: compatibilità Camelot + salti BPM, con tracce-ponte suggerite.
 */
export function PlannerPage() {
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.crateforge.planner.playlists().then(setPlaylists);
  }, []);

  const doAnalyze = async (id: number) => {
    setSelected(id);
    setBusy(true);
    try {
      setAnalysis(await window.crateforge.planner.analyze(id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set Planner</h1>
        <p className="text-sm text-muted-foreground">
          Controlla le transizioni armoniche (Camelot) e i salti di BPM di una playlist.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Limiti dichiarati</AlertTitle>
        <AlertDescription>
          L'analisi usa key e BPM presenti in libreria: se mancano, la transizione risulta "dati
          insufficienti". L'"energia" reale del brano non è nel database: il salto BPM è solo un
          indicatore approssimativo. Solo lettura: la playlist non viene modificata.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Scegli la playlist</CardTitle>
          <CardDescription>Solo playlist con almeno 2 brani.</CardDescription>
        </CardHeader>
        <CardContent>
          {playlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna playlist in libreria. Importa prima la collection (Panoramica).
            </p>
          ) : (
            <div className="max-h-48 overflow-auto rounded-md border">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => doAnalyze(p.id)}
                  disabled={busy}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${
                    selected === p.id ? 'bg-muted font-semibold' : ''
                  }`}
                >
                  <ListMusic className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-muted-foreground">{p.trackCount} brani</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle>
              2 · Transizioni: {analysis.transitions.length} — problematiche: {analysis.problems}
            </CardTitle>
            <CardDescription>
              {analysis.missingData > 0 &&
                `${analysis.missingData} transizioni con dati incompleti (key o BPM mancanti). `}
              Suggerimenti-ponte presi dalla tua libreria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[28rem] space-y-2 overflow-auto">
              {analysis.transitions.map((tr, i) => {
                const bad = tr.flags.includes('key-clash') || tr.flags.includes('bpm-jump');
                const missing = tr.flags.includes('missing-key') || tr.flags.includes('missing-bpm');
                return (
                  <div
                    key={i}
                    className={`rounded-md border p-2 text-xs ${
                      bad ? 'border-amber-500/60 bg-amber-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {bad && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                      <span className="truncate">{trackLabel(tr.from)}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{trackLabel(tr.to)}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {tr.keyOk === false && <span>Tonalità incompatibili (Camelot). </span>}
                      {tr.bpmDelta !== null && tr.bpmDelta > 6 && (
                        <span>Salto BPM {tr.bpmDelta.toFixed(1)}%. </span>
                      )}
                      {tr.keyOk === true && (tr.bpmDelta === null || tr.bpmDelta <= 6) && !missing && (
                        <span>OK.</span>
                      )}
                      {missing && <span>Dati insufficienti (key o BPM mancanti).</span>}
                    </div>
                    {tr.bridges.length > 0 && (
                      <div className="mt-1.5 border-t pt-1.5">
                        <div className="mb-0.5 flex items-center gap-1 font-medium">
                          <Route className="h-3 w-3" /> Tracce-ponte possibili:
                        </div>
                        {tr.bridges.map((b) => (
                          <div key={b.id} className="truncate text-muted-foreground">
                            • {trackLabel(b)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {busy && <p className="text-sm text-muted-foreground">Analisi in corso…</p>}
    </div>
  );
}
