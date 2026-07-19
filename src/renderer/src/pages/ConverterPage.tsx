import { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, BookOpen, Download } from 'lucide-react';
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
import { GuideDialog } from '@/components/GuideDialog';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { RekordboxDiff } from '@/components/RekordboxDiff';
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

// Sorgenti importabili per la conversione diretta X→Y. `udm` è il valore della
// colonna tracks.source dopo l'import, usato per esportare SOLO quella libreria.
type SourceId = 'rekordbox-db' | 'rekordbox-xml' | 'traktor' | 'virtualdj' | 'engine' | 'serato';
const SOURCES: { id: SourceId; label: string; ext: string; udm: string }[] = [
  { id: 'rekordbox-db', label: 'Rekordbox (master.db)', ext: 'db', udm: 'masterdb' },
  { id: 'rekordbox-xml', label: 'Rekordbox (collection XML)', ext: 'xml', udm: 'xml' },
  { id: 'traktor', label: 'Traktor (.nml)', ext: 'nml', udm: 'traktor' },
  { id: 'virtualdj', label: 'VirtualDJ (database.xml)', ext: 'xml', udm: 'virtualdj' },
  { id: 'engine', label: 'Engine DJ (m.db)', ext: 'db', udm: 'engine' },
  { id: 'serato', label: 'Serato (cartella _Serato_ o cartella musica)', ext: '', udm: 'serato' }
];

type Cap = 'full' | 'partial' | 'none';
type TpFn = (k: string, p?: Record<string, string | number>) => string;

const MATRIX: { app: string; imp: Cap; impKey: string; exp: Cap; expKey: string }[] = [
  { app: 'Rekordbox', imp: 'full', impKey: 'rbImport', exp: 'full', expKey: 'rbExport' },
  { app: 'Traktor', imp: 'full', impKey: 'trImport', exp: 'full', expKey: 'trExport' },
  { app: 'VirtualDJ', imp: 'partial', impKey: 'vdjImport', exp: 'full', expKey: 'vdjExport' },
  { app: 'Engine DJ', imp: 'full', impKey: 'enImport', exp: 'none', expKey: 'enExport' },
  { app: 'Serato', imp: 'full', impKey: 'srImport', exp: 'none', expKey: 'srExport' }
];

const CAP_ICON: Record<Cap, string> = { full: '●', partial: '◐', none: '○' };
const CAP_CLASS: Record<Cap, string> = {
  full: 'text-primary',
  partial: 'text-warning-foreground',
  none: 'text-muted-foreground'
};

/** Matrice bidirezionale: rende esplicito cosa importa/esporta CrateForge oggi. */
function ConversionMatrix({ tp }: { tp: TpFn }) {
  const cell = (cap: Cap, key: string) => (
    <td className="px-3 py-2 align-top">
      <span className={`mr-1 ${CAP_CLASS[cap]}`}>{CAP_ICON[cap]}</span>
      <span className="text-xs text-muted-foreground">{tp(key)}</span>
    </td>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tp('matrixTitle')}</CardTitle>
        <CardDescription>{tp('matrixDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{tp('colSoftware')}</th>
                <th className="px-3 py-2">{tp('colImport')}</th>
                <th className="px-3 py-2">{tp('colExport')}</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((r) => (
                <tr key={r.app} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{r.app}</td>
                  {cell(r.imp, r.impKey)}
                  {cell(r.exp, r.expKey)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span><span className="text-primary">●</span> {tp('cellFull')}</span>
          <span><span className="text-warning-foreground">◐</span> {tp('cellPartial')}</span>
          <span><span>○</span> {tp('cellNone')}</span>
          <span>· {tp('importFrom')}</span>
        </p>
      </CardContent>
    </Card>
  );
}

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
  const [guideOpen, setGuideOpen] = useState(false);
  // Conversione diretta X→Y.
  const [srcSel, setSrcSel] = useState<SourceId>('rekordbox-db');
  const [dstSel, setDstSel] = useState<Format>('traktor');
  // Se valorizzato, l'export filtra su questa sorgente (converte solo la libreria
  // X appena importata, non tutto l'hub UDM). Null = export dell'intera libreria.
  const [convertSource, setConvertSource] = useState<string | null>(null);

  const startExport = (fmt: Format) => {
    setConvertSource(null); // le card singole esportano l'intera libreria UDM
    setAcknowledged(false);
    setPending(fmt);
  };

  // Import della sorgente scelta; ritorna true se la libreria è entrata nell'UDM.
  const importSource = async (src: SourceId): Promise<boolean> => {
    setError(null);
    setOutcome(null);
    // Serato: si sceglie la CARTELLA "_Serato_" (i cue stanno nei tag dei file).
    if (src === 'serato') {
      const dir = await window.crateforge.dialog.openDirectory();
      if (!dir) return false;
      setBusy(true);
      try {
        const r = await window.crateforge.library.importSerato(dir);
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(false);
      }
    }
    const def = SOURCES.find((s) => s.id === src)!;
    let path: string | null;
    if (src === 'rekordbox-db') {
      const rb = await window.crateforge.rekordbox.defaultPaths();
      path = await window.crateforge.dialog.openFile(
        [{ name: def.label, extensions: [def.ext] }],
        rb.masterDbExists ? rb.masterDb : rb.dir
      );
    } else {
      path = await window.crateforge.dialog.openFile([{ name: def.label, extensions: [def.ext] }]);
    }
    if (!path) return false;
    setBusy(true);
    try {
      if (src === 'rekordbox-db') {
        const r = await window.crateforge.library.ingestMasterdb(path);
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
      } else if (src === 'rekordbox-xml') {
        await window.crateforge.library.ingestXml(path);
      } else {
        const r = await window.crateforge.library.importForeign(src, path);
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
        if (r.warnings?.length) setOutcome(r.warnings.join(' '));
      }
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // X→Y: importa la sorgente, poi apre il dialog dei limiti del formato di
  // destinazione; l'export effettivo (doExport) filtra sulla sorgente importata.
  const startConvert = async () => {
    const ok = await importSource(srcSel);
    if (!ok) return;
    setConvertSource(SOURCES.find((s) => s.id === srcSel)!.udm);
    setAcknowledged(false);
    setPending(dstSel);
  };

  const doExport = async () => {
    if (!pending) return;
    const fmt = FORMATS.find((f) => f.id === pending)!;
    setPending(null);
    const outPath = await window.crateforge.dialog.saveFile(fmt.defaultName, [
      { name: fmt.title, extensions: [fmt.ext] }
    ]);
    if (!outPath) return;
    // Conversione X→Y: esporta SOLO la libreria appena importata; altrimenti tutto.
    const sel = convertSource ? { source: convertSource } : undefined;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const r =
        fmt.id === 'rekordbox'
          ? await window.crateforge.exporter.rekordboxXml(outPath, sel)
          : fmt.id === 'traktor'
            ? await window.crateforge.exporter.traktorNml(outPath, sel)
            : await window.crateforge.exporter.virtualdjXml(outPath, sel);
      setOutcome(
        tp('outDone', { fmt: fmt.title, n: r.tracks.toLocaleString(locale), path: outPath }) +
          (fmt.id === 'rekordbox' ? tp('outRbTail') : '')
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setConvertSource(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
        <p className="text-sm text-muted-foreground">{tp('subtitle')}</p>
      </div>

      <RekordboxDiff page="converter" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4" /> {tp('directTitle')}
          </CardTitle>
          <CardDescription>{tp('directDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{tp('srcLabel')}</label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={srcSel}
                onChange={(e) => setSrcSel(e.target.value as SourceId)}
                disabled={busy}
              >
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="pb-2 text-muted-foreground">→</span>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{tp('dstLabel')}</label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={dstSel}
                onChange={(e) => setDstSel(e.target.value as Format)}
                disabled={busy}
              >
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={startConvert} disabled={busy}>
              <ArrowRightLeft /> {tp('convertBtn')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConversionMatrix tp={tp} />

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
            <div className="flex flex-wrap items-center gap-2">
              <SaveTargetNotice target="xml" />
              <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
                <BookOpen /> {pageText(locale, 'guide', 'openImport')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <GuideDialog kind="importXml" open={guideOpen} onOpenChange={setGuideOpen} />
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
