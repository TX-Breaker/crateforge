import { useState } from 'react';
import { CheckCheck, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Checkbox } from '@/components/ui/misc';
import { JobProgressBar } from '@/components/JobProgress';

interface Proposal {
  trackId: number;
  artist: string;
  title: string;
  field: 'year' | 'genre';
  current: string | null;
  proposed: string;
  source: string;
}

/**
 * Auto-Tagger (§6 Fase 2.4, Esperto). Solo query TESTUALI artista/titolo verso
 * MusicBrainz: nessun upload audio, mai (§8). Le proposte si applicano
 * all'UDM solo dopo revisione; verso Rekordbox si passa dall'export XML.
 */
export function TaggerPage() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doPropose = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setProposals(null);
    try {
      const r = await window.crateforge.tagger.propose(50);
      if (!r.ok) {
        setError(r.message);
      } else {
        setProposals(r.proposals);
        setChecked(new Set(r.proposals.map((_: Proposal, i: number) => i)));
        setSummary(
          `Interrogati ${r.queried} brani (max 50 per giro, ~1 al secondo per rispettare MusicBrainz); ` +
            `${r.skipped} senza match affidabile.`
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doApply = async () => {
    if (!proposals) return;
    const chosen = proposals.filter((_, i) => checked.has(i));
    const r = await window.crateforge.tagger.apply(chosen);
    setOutcome(
      `${r.applied} campi aggiornati nel database di CrateForge. I tuoi file audio NON sono ` +
        'stati toccati: per portare i tag in Rekordbox usa Converti libreria → Rekordbox XML.'
    );
    setProposals(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auto-Tagger</h1>
        <p className="text-sm text-muted-foreground">
          Completa anno e genere mancanti interrogando MusicBrainz (solo testo, mai audio).
        </p>
      </div>

      <Alert variant="warning">
        <AlertTitle>Funzione sperimentale (modalità Esperto)</AlertTitle>
        <AlertDescription>
          Serve una connessione internet. Vengono inviati SOLO artista e titolo come testo — mai
          file audio, mai dati personali. Vengono proposti solo match con confidenza alta
          (score ≥ 90); controlla comunque prima di applicare.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1 · Cerca metadati mancanti</CardTitle>
          <CardDescription>Brani con artista+titolo ma senza anno o genere.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={doPropose} disabled={busy}>
            <Globe /> Interroga MusicBrainz (max 50 brani)
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
                <Button onClick={doApply} disabled={checked.size === 0}>
                  <CheckCheck /> Applica {checked.size} proposte all'UDM
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

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
