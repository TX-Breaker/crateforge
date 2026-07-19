import { useState } from 'react';
import { CalendarClock, Database, FileSpreadsheet, ListMusic } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface HistorySession {
  session_id: string;
  session_name: string | null;
  session_date: string | null;
  tracks: number;
}

/**
 * Report SIAE (§ nuova funzione). Esporta l'elenco dei brani riprodotti in una
 * serata leggendo la CRONOLOGIA che Rekordbox già registra nel master.db
 * (nessuna cattura live). Modalità di default = "da cronologia" (consigliata);
 * la cattura live/PRO DJ LINK è mostrata solo in Esperto ed è sperimentale
 * (non ancora implementata — flaggata onestamente).
 */
export function SiaePage() {
  const { locale, mode } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'siae', k, p);
  const [captureMode, setCaptureMode] = useState<'history' | 'live'>('history');
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshSessions = async () => {
    const s = (await window.crateforge.siae.sessions()) as HistorySession[];
    setSessions(s);
    if (s.length && !s.some((x) => x.session_id === selected)) setSelected(s[0].session_id);
  };

  const doRead = async () => {
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const dbPath = await window.crateforge.dialog.openFile(
      [{ name: 'Rekordbox master.db', extensions: ['db'] }],
      rb.masterDbExists ? rb.masterDb : rb.dir
    );
    if (!dbPath) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = (await window.crateforge.siae.readHistory(dbPath)) as {
        ok: boolean;
        sessions?: number;
        rows?: number;
        message?: string;
      };
      if (r.ok) {
        setMsg({ kind: 'ok', text: tp('readOk', { sessions: r.sessions ?? 0, rows: r.rows ?? 0 }) });
        await refreshSessions();
      } else {
        setMsg({ kind: 'err', text: tp('readErr', { msg: r.message ?? '?' }) });
      }
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!selected) return;
    const sess = sessions.find((s) => s.session_id === selected);
    const suggested = `siae-${(sess?.session_name ?? 'serata').replace(/[^\w-]+/g, '_')}.xlsx`;
    const outPath = await window.crateforge.dialog.saveFile(suggested, [
      { name: 'Excel', extensions: ['xlsx'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = (await window.crateforge.siae.export(
        selected,
        outPath,
        venue || undefined,
        eventDate || undefined
      )) as { rows: number; outPath: string };
      setMsg({ kind: 'ok', text: tp('exportOk', { n: r.rows, path: r.outPath }) });
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

      <Alert>
        <AlertTitle>{tp('warnTitle')}</AlertTitle>
        <AlertDescription>{tp('warnBody')}</AlertDescription>
      </Alert>

      {/* Selettore modalità: History (default). Live solo in Esperto, disabilitato. */}
      {mode === 'expert' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tp('modeLabel')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="siae-mode"
                checked={captureMode === 'history'}
                onChange={() => setCaptureMode('history')}
              />
              {tp('modeHistory')}
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="siae-mode"
                checked={captureMode === 'live'}
                onChange={() => setCaptureMode('live')}
              />
              {tp('modeLive')}
            </label>
            {captureMode === 'live' && (
              <Alert variant="warning">
                <AlertDescription>{tp('liveExp')}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tp('step1')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={doRead} disabled={busy || captureMode === 'live'}>
            <Database className="mr-2 h-4 w-4" />
            {tp('readBtn')}
          </Button>
          <p className="text-xs text-muted-foreground">{tp('pickDb')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tp('step2')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tp('noSessions')}</p>
          ) : (
            <>
              <div className="max-h-56 overflow-auto rounded-md border">
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => setSelected(s.session_id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${
                      selected === s.session_id ? 'bg-muted font-semibold' : ''
                    }`}
                  >
                    <ListMusic className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">
                      {s.session_name ?? s.session_id}
                      {s.session_date ? ` · ${s.session_date.slice(0, 10)}` : ''}
                    </span>
                    <span className="text-muted-foreground">{tp('tracksN', { n: s.tracks })}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="siae-venue">{tp('venueLabel')}</Label>
                  <Input id="siae-venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="siae-date">{tp('dateLabel')}</Label>
                  <Input
                    id="siae-date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={doExport} disabled={busy || !selected}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {tp('exportBtn')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {msg && (
        <Alert variant={msg.kind === 'err' ? 'destructive' : 'default'}>
          <CalendarClock className="h-4 w-4" />
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
