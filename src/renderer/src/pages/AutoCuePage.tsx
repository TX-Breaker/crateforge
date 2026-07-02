import { useEffect, useRef, useState } from 'react';
import { ListMusic, Save, SaveAll, Search, Wand2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox, Input } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { Waveform } from '@/components/Waveform';

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

interface TrackResult {
  track: TrackRow;
  cues: ProposedCue[];
  meta: string | null;
  error: string | null;
  saved: boolean;
  envelope: number[];
  durationS: number | null;
}

const PAGE_SIZE = 50;

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
}

/**
 * Auto-Cue ASSISTITO (§6 Fase 2.1 + fase intermedia): si sceglie dalla
 * libreria (ricerca o intera playlist), si abilita/disabilita ogni brano,
 * si lancia l'analisi in batch e si rivedono i cue proposti PRIMA di salvare
 * (per brano o tutti insieme). Human-in-the-loop, sempre.
 */
export function AutoCuePage() {
  const [source, setSource] = useState<'search' | 'playlist'>('search');
  const [search, setSearch] = useState('');
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[]>([]);
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [enabled, setEnabled] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<TrackResult[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  useEffect(() => {
    window.crateforge.planner.playlists().then(setPlaylists);
  }, []);

  const loadTracks = async (p = page) => {
    if (source === 'playlist' && playlistId !== null) {
      const r = await window.crateforge.library.pageByPlaylist(playlistId, p * PAGE_SIZE, PAGE_SIZE);
      setTracks(r.rows);
      setTotal(r.total);
      // In una playlist di default abiliti tutto: è la selezione naturale.
      setEnabled(new Set(r.rows.filter((t: TrackRow) => t.path).map((t: TrackRow) => t.id)));
    } else {
      const r = await window.crateforge.library.page({ offset: p * PAGE_SIZE, limit: PAGE_SIZE, search });
      setTracks(r.rows);
      setTotal(r.total);
    }
    setPage(p);
  };

  const toggle = (id: number) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doBatch = async () => {
    const chosen = tracks.filter((t) => enabled.has(t.id) && t.path);
    if (chosen.length === 0) return;
    setBusy(true);
    cancelRef.current = false;
    setBatchNote(null);
    setResults([]);
    const out: TrackResult[] = [];
    for (let i = 0; i < chosen.length; i++) {
      if (cancelRef.current) break;
      const t = chosen[i];
      setBatchNote(`Analisi ${i + 1}/${chosen.length}: ${t.artist ?? '?'} – ${t.title ?? '?'}`);
      try {
        const r = await window.crateforge.cues.analyze(t.id);
        out.push(
          r.ok
            ? {
                track: t,
                cues: r.cues as ProposedCue[],
                meta:
                  `Durata ${r.durationS}s` +
                  (r.bpm ? `, BPM stimato ${r.bpm}` : '') +
                  ` — backend: ${r.backend}`,
                error: null,
                saved: false,
                envelope: (r.envelope as number[] | undefined) ?? [],
                durationS: (r.durationS as number | undefined) ?? null
              }
            : {
                track: t,
                cues: [],
                meta: null,
                error: r.message,
                saved: false,
                envelope: [],
                durationS: null
              }
        );
      } catch (err) {
        out.push({
          track: t,
          cues: [],
          meta: null,
          error: String(err),
          saved: false,
          envelope: [],
          durationS: null
        });
      }
      setResults([...out]);
    }
    setBatchNote(
      cancelRef.current
        ? `Analisi interrotta: completati ${out.length} brani su ${chosen.length}.`
        : `Analisi completata su ${out.length} brani. Rivedi i cue e salva quelli che ti convincono.`
    );
    setBusy(false);
  };

  const updateCue = (ri: number, ci: number, patch: Partial<ProposedCue>) =>
    setResults((prev) =>
      prev.map((r, i) =>
        i === ri ? { ...r, cues: r.cues.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : r
      )
    );

  const removeCue = (ri: number, ci: number) =>
    setResults((prev) =>
      prev.map((r, i) => (i === ri ? { ...r, cues: r.cues.filter((_, j) => j !== ci) } : r))
    );

  const saveOne = async (ri: number) => {
    const r = results[ri];
    await window.crateforge.cues.save(r.track.id, r.cues);
    setResults((prev) => prev.map((x, i) => (i === ri ? { ...x, saved: true } : x)));
  };

  const saveAll = async () => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.saved && !r.error && r.cues.length > 0) await saveOne(i);
    }
  };

  const savedCount = results.filter((r) => r.saved).length;

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
          Richiede il livello AI del sidecar (vedi README, <code>requirements-ai.txt</code>).
          Massimo 8 hot cue per brano (limite dell'import XML di Rekordbox). Niente viene salvato
          finché non clicchi tu; il salvataggio va nel database di CrateForge e in Rekordbox si
          porta con l'export XML.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Scegli i brani dalla libreria</CardTitle>
          <CardDescription>
            Per ricerca o per playlist intera; spunta i brani da analizzare.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={source === 'search' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSource('search')}
            >
              <Search /> Ricerca libera
            </Button>
            <Button
              variant={source === 'playlist' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSource('playlist')}
            >
              <ListMusic /> Da playlist
            </Button>
          </div>

          {source === 'search' ? (
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca per titolo o artista…"
                onKeyDown={(e) => e.key === 'Enter' && loadTracks(0)}
              />
              <Button variant="outline" onClick={() => loadTracks(0)}>
                Cerca
              </Button>
            </div>
          ) : (
            <div className="max-h-40 overflow-auto rounded-md border">
              {playlists.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Nessuna playlist in libreria: importa prima la collection dalla Panoramica.
                </p>
              ) : (
                playlists.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPlaylistId(p.id);
                      setTimeout(() => loadTracks(0), 0);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${
                      playlistId === p.id ? 'bg-muted font-semibold' : ''
                    }`}
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-muted-foreground">{p.trackCount} brani</span>
                  </button>
                ))
              )}
            </div>
          )}

          {tracks.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Button variant="outline" size="sm" onClick={() => setEnabled(new Set(tracks.filter((t) => t.path).map((t) => t.id)))}>
                  Abilita tutti
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEnabled(new Set())}>
                  Disabilita tutti
                </Button>
                <span>
                  {enabled.size} abilitati su {total.toLocaleString('it-IT')} totali
                </span>
              </div>
              <div className="max-h-64 overflow-auto rounded-md border">
                {tracks.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={enabled.has(t.id)}
                      disabled={!t.path}
                      onCheckedChange={() => toggle(t.id)}
                    />
                    <span className="flex-1 truncate">
                      {t.artist ?? '?'} – {t.title ?? '?'}
                      {!t.path && <span className="text-muted-foreground"> (senza file)</span>}
                    </span>
                  </label>
                ))}
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => loadTracks(page - 1)}>
                    ← Precedenti
                  </Button>
                  Pagina {page + 1} di {Math.ceil(total / PAGE_SIZE)}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    onClick={() => loadTracks(page + 1)}
                  >
                    Successivi →
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={doBatch} disabled={busy || enabled.size === 0}>
                  <Wand2 /> Analizza {enabled.size} brani
                </Button>
                {busy && (
                  <Button variant="outline" onClick={() => (cancelRef.current = true)}>
                    <XCircle /> Ferma dopo il brano corrente
                  </Button>
                )}
              </div>
            </>
          )}
          <JobProgressBar active={busy} />
          {batchNote && <p className="text-xs text-muted-foreground">{batchNote}</p>}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Rivedi e salva ({savedCount}/{results.length} salvati)</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <span>Sposta i tempi, rinomina, elimina i cue che non convincono.</span>
              <SaveTargetNotice target="udm" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={saveAll} disabled={busy || results.every((r) => r.saved || r.error || r.cues.length === 0)}>
              <SaveAll /> Salva tutti i non salvati
            </Button>
            <div className="max-h-[30rem] space-y-4 overflow-auto">
              {results.map((r, ri) => (
                <div key={r.track.id} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate font-medium">
                      {r.track.artist ?? '?'} – {r.track.title ?? '?'}
                    </span>
                    {r.saved && <span className="text-xs text-muted-foreground">✅ salvato</span>}
                  </div>
                  {r.error ? (
                    <p className="text-xs text-destructive">{r.error}</p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">{r.meta}</p>
                      {r.envelope.length > 0 && r.durationS !== null && (
                        <div className="mb-2 space-y-1">
                          <Waveform
                            envelope={r.envelope}
                            durationS={r.durationS}
                            cues={r.cues}
                            onMoveCue={(ci, positionMs) => updateCue(ri, ci, { positionMs })}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Trascina i marker per spostare i cue. Nessun ascolto qui: la
                            verifica a orecchio la fai in Rekordbox dopo l'import.
                          </p>
                        </div>
                      )}
                      {r.cues.map((c, ci) => (
                        <div key={ci} className="mb-1.5 flex items-center gap-2">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full border"
                            style={{ backgroundColor: c.color ?? '#888' }}
                          />
                          <Input
                            className="h-7 w-36 text-xs"
                            value={c.label}
                            onChange={(e) => updateCue(ri, ci, { label: e.target.value })}
                          />
                          <Input
                            className="h-7 w-28 text-xs"
                            type="number"
                            min={0}
                            step={100}
                            value={c.positionMs}
                            onChange={(e) => updateCue(ri, ci, { positionMs: Number(e.target.value) })}
                          />
                          <span className="text-xs text-muted-foreground">{fmtMs(c.positionMs)}</span>
                          <Button variant="ghost" size="sm" onClick={() => removeCue(ri, ci)}>
                            Rimuovi
                          </Button>
                        </div>
                      ))}
                      {!r.saved && r.cues.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => saveOne(ri)}>
                          <Save /> Salva {r.cues.length} cue
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
