import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface OplogRow {
  id: number;
  ts: string;
  operation: string;
  target: string | null;
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped';
  detail: string | null;
}

const OUTCOME_VARIANT: Record<OplogRow['outcome'], 'default' | 'destructive' | 'secondary' | 'warning'> = {
  ok: 'default',
  error: 'destructive',
  'dry-run': 'secondary',
  skipped: 'warning'
};
const OUTCOME_KEY: Record<OplogRow['outcome'], string> = {
  ok: 'outcomeOk',
  error: 'outcomeError',
  'dry-run': 'outcomeDry',
  skipped: 'outcomeSkipped'
};

/**
 * Registro operazioni (§3.7): cosa, quando, su cosa, esito — in linguaggio
 * comprensibile, esportabile come testo.
 */
export function LogPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'log', k, p);
  const [rows, setRows] = useState<OplogRow[]>([]);

  const load = async () => setRows(await window.crateforge.oplog.list(500));
  useEffect(() => {
    load();
  }, []);

  const exportLog = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-log.txt', [
      { name: 'Text', extensions: ['txt'] }
    ]);
    if (!outPath) return;
    await window.crateforge.oplog.exportTxt(outPath);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {tp('lastOps', { n: rows.length })}
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw /> {tp('refresh')}
              </Button>
              <Button variant="outline" size="sm" onClick={exportLog}>
                {tp('exportBtn')}
              </Button>
            </span>
          </CardTitle>
          <CardDescription>{tp('dryNote')}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tp('none')}</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{tp('colWhen')}</th>
                    <th className="px-3 py-2">{tp('colOp')}</th>
                    <th className="px-3 py-2">{tp('colOutcome')}</th>
                    <th className="px-3 py-2">{tp('colDetail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.ts}</td>
                      <td className="px-3 py-1.5 font-medium">{r.operation}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant={OUTCOME_VARIANT[r.outcome] ?? 'secondary'} className="text-[10px]">
                          {tp(OUTCOME_KEY[r.outcome] ?? r.outcome)}
                        </Badge>
                      </td>
                      <td className="max-w-80 px-3 py-1.5 text-muted-foreground">
                        <div className="truncate">{r.target ?? ''}</div>
                        {r.detail && <div className="truncate opacity-75">{r.detail}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
