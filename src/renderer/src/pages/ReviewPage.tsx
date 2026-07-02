import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';

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
        <h1 className="text-2xl font-semibold tracking-tight">Da revisionare</h1>
        <p className="text-sm text-muted-foreground">
          Brani con tag illeggibili o sospetti. Restano fuori dagli export finché non li sistemi
          (o decidi che vanno bene così).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {total.toLocaleString('it-IT')} brani da controllare
          </CardTitle>
          <CardDescription>
            Di solito il problema è la codifica dei caratteri (nomi asiatici, arabi, cirillici) o
            tag scritti male da altri programmi. Correggi i tag nel tuo editor preferito e
            re-importa la libreria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Niente da revisionare: tutti i tag della libreria sono leggibili.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Artista</th>
                    <th className="px-3 py-2">Titolo</th>
                    <th className="px-3 py-2">Motivo</th>
                    <th className="px-3 py-2">File</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5">{r.artist ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.title ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="warning" className="text-[10px]">
                          {r.review_reason ?? 'tag sospetto'}
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
                ← Precedenti
              </Button>
              Pagina {page + 1} di {Math.ceil(total / PAGE_SIZE)}
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => load(page + 1)}
              >
                Successivi →
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
