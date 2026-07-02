import { Card, CardContent } from '@/components/ui/card';
import logoUrl from '../../../../assets/branding/rekordbox-dj-italia-logo.svg';

/**
 * Schermata Info/About (§5, §12.5): logo placeholder (sostituibile in
 * assets/branding/) + credito.
 */
export function AboutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Informazioni</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <img src={logoUrl} alt="Rekordbox DJ Italia Group" className="h-24 w-24" />
          <div>
            <div className="text-xl font-bold">CrateForge</div>
            <div className="text-sm text-muted-foreground">
              Library manager e utility di manutenzione per DJ
            </div>
          </div>
          <p className="text-sm">
            Sviluppato da <b>TX-Breaker</b> in collaborazione con <b>Rekordbox DJ Italia Group</b>
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            CrateForge è compatibile con Rekordbox ma non è affiliato ad AlphaTheta/Pioneer DJ.
            Rekordbox, Serato, Traktor, Engine DJ e VirtualDJ sono marchi dei rispettivi
            proprietari. CrateForge non modifica mai i tuoi file originali: lavora sempre su copie.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
