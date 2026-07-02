import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, Label, Switch } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';

/**
 * Generatore di Report Excel (§6 Fase 1.3). Export on-demand: il file viene
 * scritto in streaming nel main process, qui solo opzioni e avanzamento.
 */
export function ReportPage() {
  const [camelot, setCamelot] = useState(true);
  const [groupByArtist, setGroupByArtist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doGenerate = async () => {
    const outPath = await window.crateforge.dialog.saveFile('libreria-crateforge.xlsx', [
      { name: 'Cartella di lavoro Excel', extensions: ['xlsx'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const r = await window.crateforge.report.generate({
        outPath,
        camelotNotation: camelot,
        groupByArtist
      });
      setOutcome(`Report creato: ${r.rows.toLocaleString('it-IT')} brani in ${r.outPath}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Report Excel</h1>
        <p className="text-sm text-muted-foreground">
          Un file .xlsx con tutta la libreria: artista, titolo, versione, BPM, key, durata e tag
          mancanti evidenziati in rosso.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Opzioni</CardTitle>
          <CardDescription>
            Il report si apre con Excel, LibreOffice o Numbers. I filtri colonna sono già attivi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between text-sm">
            <span>
              <Label>Notazione Camelot per la key</Label>
              <p className="text-xs text-muted-foreground">Es. 8A invece di A minor</p>
            </span>
            <Switch checked={camelot} onCheckedChange={setCamelot} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>
              <Label>Raggruppa per artista</Label>
              <p className="text-xs text-muted-foreground">Ordina il foglio per artista, poi titolo</p>
            </span>
            <Switch checked={groupByArtist} onCheckedChange={setGroupByArtist} />
          </label>
          <Button onClick={doGenerate} disabled={busy}>
            <FileSpreadsheet /> Genera report…
          </Button>
          <JobProgressBar active={busy} />
        </CardContent>
      </Card>

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
