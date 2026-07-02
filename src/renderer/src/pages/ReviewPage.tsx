import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
  review_reason: string | null;
}

const PAGE_SIZE = 50;

/**
 * Vista "Da revisionare" (§6 Fase 1.6): brani con tag illeggibili/corrotti.
 * Non inquinano gli export: qui l'utente li vede e decide. Lettura paginata
 * dall'UDM: mai l'intera libreria in memoria.
 */
export function ReviewPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'review', k, p);
  const tc = (k: string, p?: Record<string, string | number>) => pageText(locale, 'common', k, p);
  const [rows, setRows] = useState<TrackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const load = async (p: number) => {
    const r = await window.crateforge.library.page({
      offset: p * PAGE_SIZE,
      limit: PAGE_SIZE,
      needsReview: true
    });
    setRows(r.rows);
    setTotal(r.total);
    setPage(p);
  };

  useEffect(() => {
    load(0);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tp('countTitle', { n: total.toLocaleString(locale) })}</CardTitle>
          <CardDescription>{tp('countDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tp('none')}</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{tp('colArtist')}</th>
                    <th className="px-3 py-2">{tp('colTitle')}</th>
                    <th className="px-3 py-2">{tp('colReason')}</th>
                    <th className="px-3 py-2">{tp('colFile')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5">{r.artist ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.title ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="warning" className="text-[10px]">
                          {r.review_reason ?? tp('defaultReason')}
                        </Badge>
                      </td>
                      <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground">
                        {r.path ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => load(page - 1)}>
                {tc('prev')}
              </Button>
              {tc('pageOf', { p: page + 1, tot: Math.ceil(total / PAGE_SIZE) })}
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => load(page + 1)}
              >
                {tc('next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
