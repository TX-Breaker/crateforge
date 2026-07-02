import { useState } from 'react';
import { Save, Search, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
}

interface ProposedCue {
  label: string;
  positionMs: number;
  color: string | null;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
}

/**
 * Auto-Cue ASSISTITO (§6 Fase 2.1, Esperto, human-in-the-loop).
 * Il tool PROPONE fino a 8 cue; l'utente li rivede, li corregge e solo con
 * "salva" finiscono nell'UDM. Verso Rekordbox si passa sempre dall'export XML.
 */
export function AutoCuePage() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TrackRow[]>([]);
  const [track, setTrack] = useState<TrackRow | null>(null);
  const [cues, setCues] = useState<ProposedCue[] | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    const r = await window.crateforge.library.page({ offset: 0, limit: 20, search });
    setResults(r.rows);
  };

  const doAnalyze = async () => {
    if (!track) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setCues(null);
    try {
      const r = await window.crateforge.cues.analyze(track.id);
      if (!r.ok) {
        setError(r.message);
      } else {
        setCues(r.cues as ProposedCue[]);
        setMeta(
          `Durata ${r.durationS}s` +
            (r.bpm ? `, BPM stimato ${r.bpm}` : '') +
            ` — backend: ${r.backend}`
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateCue = (i: number, patch: Partial<ProposedCue>) =>
    setCues((prev) => prev?.map((c, j) => (j === i ? { ...c, ...patch } : c)) ?? null);

  const doSave = async () => {
    if (!track || !cues) return;
    const r = await window.crateforge.cues.save(track.id, cues);
    setOutcome(
      `${r.saved} hot cue salvati nel database di CrateForge per "${track.title}". ` +
        'Per portarli in Rekordbox: Converti libreria → Rekordbox XML, poi import manuale.'
    );
    setCues(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auto-Cue assistito</h1>
        <p className="text-sm text-muted-foreground">
          Cue suggeriti automaticamente. Controllali sempre: nessun algoritmo sostituisce il tuo
          orecchio.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Funzione sperimentale (modalità Esperto)</AlertTitle>
        <AlertDescription>
          Richiede il livello AI del sidecar (vedi README, <code>requirements-ai.txt</code>). I cue
          proposti sono euristiche su onset ed energia: intro, drop, breakdown, outro. Niente viene
          salvato finché non clicchi tu. Massimo 8 hot cue (limite dell'import XML di Rekordbox).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Scegli il brano</CardTitle>
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
                  onClick={() => {
                    setTrack(t);
                    setCues(null);
                    setOutcome(null);
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted ${
                    track?.id === t.id ? 'bg-muted font-semibold' : ''
                  }`}
                >
                  {t.artist ?? '?'} – {t.title ?? '?'}
                </button>
              ))}
            </div>
          )}
          {track && (
            <Button onClick={doAnalyze} disabled={busy}>
              <Wand2 /> Analizza "{track.title ?? '?'}"
            </Button>
          )}
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

      {cues && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Rivedi i cue proposti</CardTitle>
            <CardDescription>{meta}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cues.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 rounded-full border"
                  style={{ backgroundColor: c.color ?? '#888' }}
                />
                <Input
                  className="w-40"
                  value={c.label}
                  onChange={(e) => updateCue(i, { label: e.target.value })}
                />
                <Input
                  className="w-32"
                  type="number"
                  min={0}
                  step={100}
                  value={c.positionMs}
                  onChange={(e) => updateCue(i, { positionMs: Number(e.target.value) })}
                />
                <span className="text-xs text-muted-foreground">{fmtMs(c.positionMs)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCues((prev) => prev?.filter((_, j) => j !== i) ?? null)}
                >
                  Rimuovi
                </Button>
              </div>
            ))}
            <Button onClick={doSave} disabled={cues.length === 0}>
              <Save /> Salva {cues.length} cue nell'UDM
            </Button>
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
    </div>
  );
}
