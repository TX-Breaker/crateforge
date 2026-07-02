import { useEffect, useState } from 'react';
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

type Format = 'rekordbox' | 'traktor' | 'virtualdj';

interface Limits {
  rekordboxXml: string[];
  serato: { available: boolean; reason: string };
  engine: { available: boolean; reason: string };
}

const FORMATS: { id: Format; title: string; desc: string; ext: string; defaultName: string }[] = [
  {
    id: 'rekordbox',
    title: 'Rekordbox XML',
    desc: 'Per re-import nella collection o per condividere la libreria.',
    ext: 'xml',
    defaultName: 'crateforge-rekordbox.xml'
  },
  {
    id: 'traktor',
    title: 'Traktor NML',
    desc: 'Hot cue, beatgrid e playlist per Traktor Pro.',
    ext: 'nml',
    defaultName: 'crateforge-traktor.nml'
  },
  {
    id: 'virtualdj',
    title: 'VirtualDJ XML',
    desc: 'Database XML importabile in VirtualDJ.',
    ext: 'xml',
    defaultName: 'crateforge-virtualdj.xml'
  }
];

/**
 * Converter Anti-Lock-in (§6 Fase 1.4). Prima di OGNI export l'utente vede i
 * limiti reali del canale (§4/§7) in un dialog non ignorabile: si esporta solo
 * dopo aver spuntato la presa visione.
 */
export function ConverterPage() {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [pending, setPending] = useState<Format | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.crateforge.exporter.limits().then(setLimits);
  }, []);

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
        `Export ${fmt.title} completato: ${r.tracks.toLocaleString('it-IT')} brani in ${outPath}. ` +
          (fmt.id === 'rekordbox'
            ? "Ora apri Rekordbox, imposta questo file in Preferenze → Avanzate → rekordbox xml, poi clicca tu 'Import to Collection': l'import finale è manuale."
            : '')
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
        <h1 className="text-2xl font-semibold tracking-tight">Converti libreria</h1>
        <p className="text-sm text-muted-foreground">
          Esporta la libreria verso altri software DJ. Sempre su file nuovi: gli originali non
          vengono toccati.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
              <CardDescription>{f.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => startExport(f.id)} disabled={busy}>
                <Download /> Esporta…
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="opacity-75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Serato <Badge variant="secondary">In arrivo</Badge>
            </CardTitle>
            <CardDescription>{limits?.serato.reason}</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Engine DJ <Badge variant="secondary">In arrivo</Badge>
            </CardTitle>
            <CardDescription>{limits?.engine.reason}</CardDescription>
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
              <AlertTriangle className="h-5 w-5 text-warning-foreground" /> Prima di esportare:
              cosa devi sapere
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2">
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {(limits?.rekordboxXml ?? []).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="text-sm">
                  Questi sono limiti del formato, non di CrateForge: nessun tool può aggirarli.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            Ho letto e capito i limiti dell'export
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Annulla
            </Button>
            <Button disabled={!acknowledged} onClick={doExport}>
              Continua con l'export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
