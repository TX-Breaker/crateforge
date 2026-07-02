import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';

interface OplogRow {
  id: number;
  ts: string;
  operation: string;
  target: string | null;
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped';
  detail: string | null;
}

const OUTCOME_LABEL: Record<OplogRow['outcome'], { label: string; variant: 'default' | 'destructive' | 'secondary' | 'warning' }> = {
  ok: { label: 'OK', variant: 'default' },
  error: { label: 'Errore', variant: 'destructive' },
  'dry-run': { label: 'Anteprima', variant: 'secondary' },
  skipped: { label: 'Saltato', variant: 'warning' }
};

/**
 * Registro operazioni (§3.7): cosa, quando, su cosa, esito — in linguaggio
 * comprensibile, esportabile come testo.
 */
export function LogPage() {
  const [rows, setRows] = useState<OplogRow[]>([]);

  const load = async () => setRows(await window.crateforge.oplog.list(500));
  useEffect(() => {
    load();
  }, []);

  const exportLog = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-log.txt', [
      { name: 'File di testo', extensions: ['txt'] }
    ]);
    if (!outPath) return;
    await window.crateforge.oplog.exportTxt(outPath);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registro operazioni</h1>
        <p className="text-sm text-muted-foreground">
          Tutto quello che CrateForge ha fatto, con data ed esito. Nessuna operazione è invisibile.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Ultime {rows.length} operazioni
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw /> Aggiorna
              </Button>
              <Button variant="outline" size="sm" onClick={exportLog}>
                Esporta…
              </Button>
            </span>
          </CardTitle>
          <CardDescription>"Anteprima" = simulazione senza toccare nessun file.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ancora nessuna operazione registrata.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Quando</th>
                    <th className="px-3 py-2">Operazione</th>
                    <th className="px-3 py-2">Esito</th>
                    <th className="px-3 py-2">Dettagli</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const o = OUTCOME_LABEL[r.outcome] ?? { label: r.outcome, variant: 'secondary' as const };
                    return (
                      <tr key={r.id} className="border-b align-top last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.ts}</td>
                        <td className="px-3 py-1.5 font-medium">{r.operation}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant={o.variant} className="text-[10px]">
                            {o.label}
                          </Badge>
                        </td>
                        <td className="max-w-80 px-3 py-1.5 text-muted-foreground">
                          <div className="truncate">{r.target ?? ''}</div>
                          {r.detail && <div className="truncate opacity-75">{r.detail}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
