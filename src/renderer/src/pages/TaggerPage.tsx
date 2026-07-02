import { useEffect, useState } from 'react';
import { CheckCheck, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox, Label } from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { JobProgressBar } from '@/components/JobProgress';
import { SaveTargetNotice, type SaveTarget } from '@/components/SaveTargetNotice';

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
          `Interrogati ${r.queried} brani via ${provider === 'discogs' ? 'Discogs' : 'MusicBrainz'} ` +
            `(max 50 per giro, ~1 al secondo per rispettare i limiti del servizio); ` +
            `${r.skipped} senza match affidabile.`
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
    setOutcome({
      text:
        `${r.applied} campi aggiornati nel database di CrateForge. I tuoi file audio NON sono ` +
        'stati toccati: per portare i tag in Rekordbox usa Converti libreria → Rekordbox XML.',
      target: 'udm'
    });
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
          text:
            `Tag scritti su ${r.written} file ORIGINALI (falliti: ${r.failed ?? 0}). ` +
            `Backup verificato di ogni file in: ${r.backupDir}. ` +
            'Anche il database interno è stato aggiornato.',
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
        <h1 className="text-2xl font-semibold tracking-tight">Auto-Tagger</h1>
        <p className="text-sm text-muted-foreground">
          Completa anno e genere mancanti interrogando servizi pubblici (solo testo, mai audio).
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Funzione sperimentale (modalità Esperto)</AlertTitle>
        <AlertDescription>
          Serve una connessione internet. Vengono inviati SOLO artista e titolo come testo — mai
          file audio, mai dati personali. Controlla sempre le proposte prima di applicare.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Cerca metadati mancanti</CardTitle>
          <CardDescription>Brani con artista+titolo ma senza anno o genere.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <div className="flex gap-2">
              <Button
                variant={provider === 'musicbrainz' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setProvider('musicbrainz')}
              >
                MusicBrainz (senza account)
              </Button>
              <Button
                variant={provider === 'discogs' ? 'default' : 'outline'}
                size="sm"
                disabled={!hasDiscogsToken}
                onClick={() => setProvider('discogs')}
              >
                Discogs {hasDiscogsToken ? '' : '(serve token in Impostazioni)'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              MusicBrainz: gratuito, nessun account, generi da tag della community. Discogs: generi
              più precisi per la musica da club (es. "Tech House"), richiede un token personale
              gratuito.
            </p>
          </div>
          <Button onClick={doPropose} disabled={busy}>
            <Globe /> Interroga {provider === 'discogs' ? 'Discogs' : 'MusicBrainz'} (max 50 brani)
          </Button>
          <JobProgressBar active={busy} />
          {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
        </CardContent>
      </Card>

      {proposals && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Rivedi le proposte ({proposals.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessuna proposta affidabile per questo giro.
              </p>
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
                        {p.field === 'year' ? 'Anno' : 'Genere'}: <b>{p.proposed}</b>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{p.source}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={doApplyUdm} disabled={checked.size === 0 || busy}>
                    <CheckCheck /> Applica {checked.size} al database (sicuro)
                  </Button>
                  {directWrites && (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmOriginal(true)}
                      disabled={checked.size === 0 || busy}
                    >
                      Scrivi {checked.size} nei FILE ORIGINALI
                    </Button>
                  )}
                </div>
                {!directWrites && (
                  <p className="text-xs text-muted-foreground">
                    Vuoi scrivere i tag direttamente nei file audio? Attiva le "scritture dirette"
                    in Impostazioni → Esperto (con backup e rollback automatici).
                  </p>
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
        title="Scrivere i tag nei file originali?"
        confirmWord="SCRIVI"
        confirmLabel={`Scrivi ${checked.size} proposte sugli originali`}
        onConfirm={doApplyOriginal}
        description={
          <>
            <p>
              I tag verranno scritti dentro <b>i tuoi file audio originali</b> (
              {chosen().length} campi). Prima di ogni scrittura viene creato un backup del file
              verificato con hash; in caso di errore il file viene ripristinato automaticamente.
            </p>
            <p>
              Nota: alcuni programmi DJ rileggono i tag solo dopo una nuova analisi del brano.
            </p>
          </>
        }
      />
    </div>
  );
}
