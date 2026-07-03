import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Database, ListMusic, Minus, Search, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label } from '@/components/ui/misc';
import { SaveTargetNotice, type SaveTarget } from '@/components/SaveTargetNotice';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface SetTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number;
  camelot: string;
  genre: string | null;
  duration_s: number | null;
}

interface BuildResult {
  tracks: SetTrack[];
  requested: number;
  exhausted: boolean;
  totalDurationS: number;
}

type Curve = 'up' | 'flat' | 'down';

function fmtDur(s: number): string {
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Set Builder (Esperto, read-only): scaletta suggerita per key compatibili
 * e curva BPM. È matematica dichiarata come tale — la UI lo dice — e
 * l'export è il solito XML da importare a mano.
 */
export function SetBuilderPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'setbuilder', k, p);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TrackRow[]>([]);
  const [start, setStart] = useState<TrackRow | null>(null);
  const [length, setLength] = useState(10);
  const [curve, setCurve] = useState<Curve>('up');
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; target: SaveTarget } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [masterDbWrites, setMasterDbWrites] = useState(false);
  const [confirmMdb, setConfirmMdb] = useState(false);

  useEffect(() => {
    window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDbWrites(v === '1'));
  }, []);

  const doSearch = async () => {
    const r = await window.crateforge.library.page({ offset: 0, limit: 20, search });
    setResults(r.rows);
  };

  const doBuild = async () => {
    if (!start) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      setBuilt(await window.crateforge.setbuilder.build(start.id, length, curve));
    } catch (err) {
      setError(String(err));
      setBuilt(null);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!built) return;
    const outPath = await window.crateforge.dialog.saveFile('crateforge-set.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    const name = tp('plName');
    const r = await window.crateforge.setbuilder.exportXml(
      built.tracks.map((t) => t.id),
      name,
      outPath
    );
    setOutcome({ text: tp('outDone', { name, path: outPath, n: r.written }), target: 'xml' });
  };

  const doMasterdbWrite = async () => {
    if (!built) return;
    const masterDbPath = await window.crateforge.dialog.openFile([
      { name: 'Rekordbox master.db', extensions: ['db'] }
    ]);
    if (!masterDbPath) return;
    const optionsPath = await window.crateforge.dialog.openFile([
      { name: 'options.json', extensions: ['json'] }
    ]);
    const name = tp('plName');
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const r = await window.crateforge.masterdb.createPlaylist(
        built.tracks.map((t) => t.id),
        name,
        masterDbPath,
        optionsPath
      );
      if (!r.ok) {
        setError(tp('mdbErr', { msg: r.message ?? '?' }));
      } else {
        setOutcome({
          text: tp('mdbOutDone', { name, n: r.added, missing: r.missing, dir: r.backupDir }),
          target: 'masterdb'
        });
      }
    } catch (err) {
      setError(tp('mdbErr', { msg: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const curves: { id: Curve; label: string; icon: React.ReactNode }[] = [
    { id: 'up', label: tp('curveUp'), icon: <ArrowUp /> },
    { id: 'flat', label: tp('curveFlat'), icon: <Minus /> },
    { id: 'down', label: tp('curveDown'), icon: <ArrowDown /> }
  ];

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
          <CardTitle>{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
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
              {results.map((t) => {
                const valid = !!t.camelot && !!t.bpm;
                return (
                  <button
                    key={t.id}
                    disabled={!valid}
                    onClick={() => {
                      setStart(t);
                      setBuilt(null);
                      setOutcome(null);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 ${
                      start?.id === t.id ? 'bg-muted font-semibold' : ''
                    }`}
                  >
                    <span className="flex-1 truncate">
                      {t.artist ?? '?'} – {t.title ?? '?'}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {valid ? `${Math.round(t.bpm!)} BPM · ${t.camelot}` : tp('missingData')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>{tp('lenLabel')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="w-20"
                  type="number"
                  min={2}
                  max={60}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">{tp('lenN', { n: length })}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{tp('curveLabel')}</Label>
              <div className="flex gap-2">
                {curves.map((c) => (
                  <Button
                    key={c.id}
                    variant={curve === c.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurve(c.id)}
                  >
                    {c.icon} {c.label}
                  </Button>
                ))}
              </div>
            </div>
            <Button onClick={doBuild} disabled={!start || busy}>
              <Sparkles /> {built ? tp('rebuildBtn') : tp('buildBtn')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {built && (
        <Card>
          <CardHeader>
            <CardTitle>
              {tp('step2', { n: built.tracks.length, dur: fmtDur(built.totalDurationS) })}
            </CardTitle>
            {built.exhausted && <CardDescription>{tp('exhausted')}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 overflow-auto rounded-md border">
              {built.tracks.map((t, i) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                >
                  <span className="w-6 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate">
                    {t.artist ?? '?'} – {t.title ?? '?'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {Math.round(t.bpm)} BPM · {t.camelot}
                  </span>
                  {i < built.tracks.length - 1 && (
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={doExport}>
                <ListMusic /> {tp('exportBtn')}
              </Button>
              {masterDbWrites && (
                <Button variant="destructive" onClick={() => setConfirmMdb(true)} disabled={busy}>
                  <Database /> {tp('mdbBtn')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {outcome && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{outcome.text}</p>
            <SaveTargetNotice target={outcome.target} />
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DangerConfirmDialog
        open={confirmMdb}
        onOpenChange={setConfirmMdb}
        title={tp('mdbDlgTitle')}
        confirmWord="MASTERDB"
        confirmLabel={tp('mdbDlgLabel')}
        onConfirm={doMasterdbWrite}
        description={
          <>
            <p>{tp('mdbDlgBody1', { name: tp('plName'), n: built?.tracks.length ?? 0 })}</p>
            <p>{tp('mdbDlgBody2')}</p>
          </>
        }
      />
    </div>
  );
}
