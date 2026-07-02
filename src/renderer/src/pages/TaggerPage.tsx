import { useEffect, useState } from 'react';
import { CheckCheck, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox, Label } from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice, type SaveTarget } from '@/components/SaveTargetNotice';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

interface Proposal {
  trackId: number;
  artist: string;
  title: string;
  field: 'year' | 'genre';
  current: string | null;
  proposed: string;
  source: string;
}

type Provider = 'musicbrainz' | 'discogs';

/**
 * Auto-Tagger (§6 Fase 2.4, Esperto). Solo query TESTUALI artista/titolo —
 * mai upload audio (§8). Due destinazioni per l'apply:
 *  - UDM (default, sicuro): la strada verso Rekordbox resta l'export XML;
 *  - file originali (opt-in "scritture dirette"): ID3 via sidecar con
 *    backup verificato e rollback automatico.
 */
export function TaggerPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'tagger', k, p);
  const [provider, setProvider] = useState<Provider>('musicbrainz');
  const [hasDiscogsToken, setHasDiscogsToken] = useState(false);
  const [directWrites, setDirectWrites] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; target: SaveTarget } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOriginal, setConfirmOriginal] = useState(false);

  useEffect(() => {
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    window.crateforge.settings.get('discogsToken').then((v) => setHasDiscogsToken(!!v));
  }, []);

  const doPropose = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setProposals(null);
    try {
      const r = await window.crateforge.tagger.propose(50, provider);
      if (!r.ok) {
        setError(r.message);
      } else {
        setProposals(r.proposals);
        setChecked(new Set(r.proposals.map((_: Proposal, i: number) => i)));
        setSummary(
          tp('summary', {
            n: r.queried,
            prov: provider === 'discogs' ? 'Discogs' : 'MusicBrainz',
            skipped: r.skipped
          })
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const chosen = () => (proposals ?? []).filter((_, i) => checked.has(i));

  const doApplyUdm = async () => {
    const r = await window.crateforge.tagger.apply(chosen(), 'udm');
    setOutcome({ text: tp('outUdm', { n: r.applied }), target: 'udm' });
    setProposals(null);
  };

  const doApplyOriginal = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.tagger.apply(chosen(), 'original');
      if (!r.ok) {
        setError(r.message ?? 'Scrittura non riuscita.');
      } else {
        setOutcome({
          text: tp('outOrig', { n: r.written, failed: r.failed ?? 0, dir: r.backupDir }),
          target: 'original'
        });
        setProposals(null);
      }
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
          <div className="space-y-1.5">
            <Label>{tp('provLabel')}</Label>
            <div className="flex gap-2">
              <Button
                variant={provider === 'musicbrainz' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setProvider('musicbrainz')}
              >
                {tp('provMb')}
              </Button>
              <Button
                variant={provider === 'discogs' ? 'default' : 'outline'}
                size="sm"
                disabled={!hasDiscogsToken}
                onClick={() => setProvider('discogs')}
              >
                {tp('provDiscogs')} {hasDiscogsToken ? '' : tp('provNoToken')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{tp('provDesc')}</p>
          </div>
          <Button onClick={doPropose} disabled={busy}>
            <Globe /> {tp('queryBtn', { prov: provider === 'discogs' ? 'Discogs' : 'MusicBrainz' })}
          </Button>
          <JobProgressBar active={busy} />
          {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
        </CardContent>
      </Card>

      {proposals && (
        <Card>
          <CardHeader>
            <CardTitle>{tp('step2', { n: proposals.length })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tp('none')}</p>
            ) : (
              <>
                <div className="max-h-80 overflow-auto rounded-md border">
                  {proposals.map((p, i) => (
                    <label
                      key={i}
                      className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked.has(i)}
                        onCheckedChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                      />
                      <span className="flex-1 truncate">
                        {p.artist} – {p.title}
                      </span>
                      <span className="shrink-0">
                        {p.field === 'year' ? tp('fieldYear') : tp('fieldGenre')}: <b>{p.proposed}</b>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{p.source}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={doApplyUdm} disabled={checked.size === 0 || busy}>
                    <CheckCheck /> {tp('applyUdm', { n: checked.size })}
                  </Button>
                  {directWrites && (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmOriginal(true)}
                      disabled={checked.size === 0 || busy}
                    >
                      {tp('applyOrig', { n: checked.size })}
                    </Button>
                  )}
                </div>
                {!directWrites && (
                  <p className="text-xs text-muted-foreground">{tp('directHint')}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {outcome && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{outcome.text}</p>
            <SaveTargetNotice target={outcome.target} />
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DangerConfirmDialog
        open={confirmOriginal}
        onOpenChange={setConfirmOriginal}
        title={tp('dlgTitle')}
        confirmWord="SCRIVI"
        confirmLabel={tp('dlgLabel', { n: checked.size })}
        onConfirm={doApplyOriginal}
        description={
          <>
            <p>{tp('dlgBody1', { n: chosen().length })}</p>
            <p>{tp('dlgBody2')}</p>
          </>
        }
      />
    </div>
  );
}
