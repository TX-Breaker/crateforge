import { useState } from 'react';
import { BookOpen, FileSearch, Fingerprint, MapPin } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { GuideDialog } from '@/components/GuideDialog';
import { PathField } from '@/pages/BackupPage';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import type { Locale } from '@/lib/i18n';

interface BrokenRow {
  trackId: number;
  title: string | null;
  artist: string | null;
  oldPath: string;
}

interface MatchSummary {
  broken: number;
  matched: number;
  ambiguous: number;
  written: number;
}

/**
 * Relocator Esterno base (§6 Fase 1.5), modalità Esperto. Flusso: trova path
 * rotti → scegli nuova cartella → dry-run (solo conteggi) → genera XML di
 * aggiornamento da re-importare in Rekordbox. Mai scritture nel master.db.
 */
export function RelocatorPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'relocator', k, p);
  const [broken, setBroken] = useState<BrokenRow[] | null>(null);
  const [newRoot, setNewRoot] = useState('');
  const [dryRun, setDryRun] = useState<MatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const findBroken = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setDryRun(null);
    try {
      setBroken(await window.crateforge.relocator.findBroken());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDryRun = async () => {
    setBusy(true);
    setError(null);
    try {
      setDryRun(await window.crateforge.relocator.matchAndWrite(newRoot, null));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.relocator.matchAndWrite(newRoot, outPath);
      setOutcome(tp('outDone', { n: r.written, path: outPath }));
      setDryRun(null);
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

      <Alert variant="warning">
        <AlertTitle>{tp('warnTitle')}</AlertTitle>
        <AlertDescription>{tp('warnBody')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={findBroken} disabled={busy}>
            <FileSearch /> {tp('findBtn')}
          </Button>
          {broken && (
            <p className="text-sm">
              {tp('brokenCount')} <b>{broken.length.toLocaleString(locale)}</b>
            </p>
          )}
          {broken && broken.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border p-2 text-xs text-muted-foreground">
              {broken.slice(0, 200).map((b) => (
                <div key={b.trackId} className="truncate">
                  {b.artist ?? '?'} – {b.title ?? '?'} <span className="opacity-60">({b.oldPath})</span>
                </div>
              ))}
              {broken.length > 200 && <div>{tp('moreN', { n: broken.length - 200 })}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {broken && broken.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{tp('step2')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PathField
              label={tp('fNewRoot')}
              value={newRoot}
              onBrowse={async () => {
                const d = await window.crateforge.dialog.openDirectory();
                if (d) setNewRoot(d);
              }}
            />
            <Button onClick={doDryRun} disabled={!newRoot || busy}>
              {tp('dryBtn')}
            </Button>
            {dryRun && (
              <Alert>
                <AlertDescription>
                  {tp('dryLine', {
                    broken: dryRun.broken,
                    matched: dryRun.matched,
                    ambiguous: dryRun.ambiguous,
                    missing: dryRun.broken - dryRun.matched
                  })}
                </AlertDescription>
              </Alert>
            )}
            {dryRun && dryRun.matched > 0 && (
              <Button onClick={doWrite} disabled={busy}>
                <MapPin /> {tp('writeBtn')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <FingerprintRelocator
        locale={locale}
        newRoot={newRoot}
        setBusy={setBusy}
        setError={setError}
        setOutcome={setOutcome}
        busy={busy}
      />

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
    </div>
  );
}

/**
 * Relocator per fingerprint (§6 Fase 2.3): ritrova i file anche se RINOMINATI,
 * confrontando l'impronta acustica. Richiede impronte già calcolate (pagina
 * "Duplicati") quando i file erano ancora al loro posto.
 */
function FingerprintRelocator({
  locale,
  newRoot,
  busy,
  setBusy,
  setError,
  setOutcome
}: {
  locale: Locale;
  newRoot: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  setOutcome: (v: string | null) => void;
}) {
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'relocator', k, p);
  const [fpSummary, setFpSummary] = useState<{ broken: number; matched: number; scanned: number } | null>(null);

  const doMatch = async () => {
    setBusy(true);
    setError(null);
    setFpSummary(null);
    try {
      const r = await window.crateforge.relocatorFp.match(newRoot);
      if (!r.ok) setError(r.message);
      else setFpSummary(r as { broken: number; matched: number; scanned: number });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation-fp.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    try {
      const r = await window.crateforge.relocatorFp.writeXml(outPath);
      setOutcome(tp('outFpDone', { n: r.written, path: outPath }));
      setFpSummary(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4" /> {tp('fpTitle')}
        </CardTitle>
        <CardDescription>{tp('fpDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={doMatch} disabled={!newRoot || busy} variant="secondary">
          {tp('fpBtn')}
        </Button>
        {fpSummary && (
          <>
            <Alert>
              <AlertDescription>
                {tp('fpLine', {
                  scanned: fpSummary.scanned,
                  broken: fpSummary.broken,
                  matched: fpSummary.matched
                })}
              </AlertDescription>
            </Alert>
            {fpSummary.matched > 0 && (
              <Button onClick={doWrite} disabled={busy}>
                <MapPin /> {tp('writeBtn')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
