import { useEffect, useState } from 'react';
import { HeartPulse, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { RekordboxDiff } from '@/components/RekordboxDiff';

interface Health {
  total: number;
  missingBpm: number;
  missingKey: number;
  missingGenre: number;
  missingYear: number;
  needsReview: number;
  withoutHotCues: number;
  duplicateGroups: number;
  duplicateTracks: number;
  fingerprinted: number;
  score: number;
}

/**
 * Salute libreria (modalità Semplice, read-only): punteggio + righe
 * "cosa manca / dove sistemarlo". Nessuna azione diretta da qui: solo
 * diagnosi onesta e indicazioni.
 */
export function HealthPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'health', k, p);
  const [h, setH] = useState<Health | null>(null);

  const load = () => window.crateforge.health.get().then(setH);
  useEffect(() => {
    load();
  }, []);

  if (!h) return <p className="text-sm text-muted-foreground">…</p>;

  const scoreMsg = h.score >= 85 ? tp('scoreGood') : h.score >= 60 ? tp('scoreMid') : tp('scoreBad');
  const pct = (n: number) => (h.total > 0 ? Math.round((n / h.total) * 100) : 0);

  const rows: { label: string; value: number; hint?: string; invert?: boolean; note?: string }[] = [
    { label: tp('rowBpm'), value: h.missingBpm },
    { label: tp('rowKey'), value: h.missingKey },
    { label: tp('rowGenre'), value: h.missingGenre, hint: tp('hintTagger') },
    { label: tp('rowYear'), value: h.missingYear, hint: tp('hintTagger') },
    { label: tp('rowReview'), value: h.needsReview, hint: tp('hintReview') },
    {
      label: tp('rowDup'),
      value: h.duplicateTracks,
      hint: tp('hintDup'),
      note: tp('dupNote', { groups: h.duplicateGroups, tracks: h.duplicateTracks })
    },
    { label: tp('rowCues'), value: h.withoutHotCues, hint: tp('hintCues') },
    { label: tp('rowFp'), value: h.fingerprinted, hint: tp('hintFp'), invert: true }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <RekordboxDiff page="health" />

      {h.total === 0 ? (
        <p className="text-sm text-muted-foreground">{tp('empty')}</p>
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center gap-6 p-6">
              <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border-4 border-primary">
                <HeartPulse className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{h.score}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-sm font-medium">{tp('scoreLabel')}</div>
                <Progress value={h.score} />
                <p className="text-sm text-muted-foreground">{scoreMsg}</p>
                <p className="text-xs text-muted-foreground">
                  {tp('totalTracks', { n: h.total.toLocaleString(locale) })}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw /> {tp('refresh')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tp('title')}</CardTitle>
              <CardDescription>{tp('subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-52 shrink-0">{r.label}</span>
                    <span className="w-24 shrink-0 font-mono text-xs">
                      {r.value.toLocaleString(locale)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={r.invert ? 'h-full bg-primary' : 'h-full bg-warning'}
                        style={{ width: `${pct(r.value)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {tp('ofTotal', { pct: pct(r.value) })}
                    </span>
                  </div>
                  {(r.hint || r.note) && (
                    <p className="pl-52 text-xs text-muted-foreground">
                      {r.note ? `${r.note} ` : ''}
                      {r.hint ?? ''}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
