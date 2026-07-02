import { useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Alert, AlertDescription, Badge, Checkbox } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { t } from '@/lib/i18n';

type Format = 'rekordbox' | 'traktor' | 'virtualdj';

const FORMATS: { id: Format; title: string; descKey: string; ext: string; defaultName: string }[] = [
  {
    id: 'rekordbox',
    title: 'Rekordbox XML',
    descKey: 'fmtRekordbox',
    ext: 'xml',
    defaultName: 'crateforge-rekordbox.xml'
  },
  {
    id: 'traktor',
    title: 'Traktor NML',
    descKey: 'fmtTraktor',
    ext: 'nml',
    defaultName: 'crateforge-traktor.nml'
  },
  {
    id: 'virtualdj',
    title: 'VirtualDJ XML',
    descKey: 'fmtVdj',
    ext: 'xml',
    defaultName: 'crateforge-virtualdj.xml'
  }
];

/**
 * Converter Anti-Lock-in (§6 Fase 1.4). Prima di OGNI export l'utente vede i
 * limiti reali del canale (§4/§7) in un dialog non ignorabile: si esporta solo
 * dopo aver spuntato la presa visione. I 5 limiti sono localizzati nel
 * dizionario pagine (fatti statici del formato); le stringhe del main restano
 * per log e fallback.
 */
export function ConverterPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'converter', k, p);
  const [pending, setPending] = useState<Format | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startExport = (fmt: Format) => {
    setAcknowledged(false);
    setPending(fmt);
  };

  const doExport = async () => {
    if (!pending) return;
    const fmt = FORMATS.find((f) => f.id === pending)!;
    setPending(null);
    const outPath = await window.crateforge.dialog.saveFile(fmt.defaultName, [
      { name: fmt.title, extensions: [fmt.ext] }
    ]);
    if (!outPath) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const r =
        fmt.id === 'rekordbox'
          ? await window.crateforge.exporter.rekordboxXml(outPath)
          : fmt.id === 'traktor'
            ? await window.crateforge.exporter.traktorNml(outPath)
            : await window.crateforge.exporter.virtualdjXml(outPath);
      setOutcome(
        tp('outDone', { fmt: fmt.title, n: r.tracks.toLocaleString(locale), path: outPath }) +
          (fmt.id === 'rekordbox' ? tp('outRbTail') : '')
      );
    } catch (err) {
      setError(String(err));
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
              <CardDescription>{tp(f.descKey)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => startExport(f.id)} disabled={busy}>
                <Download /> {tp('exportBtn')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="opacity-75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Serato <Badge variant="secondary">{tp('comingSoon')}</Badge>
            </CardTitle>
            <CardDescription>{tp('seratoReason')}</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Engine DJ <Badge variant="secondary">{tp('comingSoon')}</Badge>
            </CardTitle>
            <CardDescription>{tp('engineReason')}</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <JobProgressBar active={busy} />
      {outcome && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{outcome}</p>
            <SaveTargetNotice target="xml" />
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning-foreground" /> {tp('dlgTitle')}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2">
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {['limit1', 'limit2', 'limit3', 'limit4', 'limit5'].map((k) => (
                    <li key={k}>{tp(k)}</li>
                  ))}
                </ul>
                <p className="text-sm">{tp('dlgNote')}</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            {tp('ack')}
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t(locale, 'common.cancel')}
            </Button>
            <Button disabled={!acknowledged} onClick={doExport}>
              {tp('proceed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
