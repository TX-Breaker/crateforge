import { useEffect, useState } from 'react';
import { Apple, Check, Monitor } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { libraryLocations, osLabel, shortcut, type TargetOs } from '@core/platformProfile';

/**
 * Scelta del sistema operativo al PRIMO avvio (§ profilo OS).
 *
 * Perché esiste: scorciatoie da tastiera, percorsi delle librerie DJ e comandi
 * da terminale sono diversi tra Windows e macOS. L'app rileva l'OS e lo
 * PRE-SELEZIONA (evidenziato come "rilevato"), ma la scelta resta dell'utente:
 * capita di lavorare da un PC Windows preparando la serata per il Mac su cui si
 * suona. La scelta è modificabile in ogni momento da Impostazioni.
 */
export function OsSetupDialog() {
  const { locale, detectedOs, osChosen, confirmOs } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'ossetup', k, p);
  const [sel, setSel] = useState<TargetOs | null>(null);

  // Appena l'IPC risponde, pre-seleziona l'OS rilevato.
  useEffect(() => {
    if (detectedOs && sel === null) setSel(detectedOs);
  }, [detectedOs, sel]);

  // Non mostrare nulla finché non so l'OS reale, o se la scelta è già stata fatta.
  if (osChosen || detectedOs === null || sel === null) return null;

  const options: { id: TargetOs; icon: React.ReactNode }[] = [
    { id: 'win', icon: <Monitor className="h-5 w-5" /> },
    { id: 'mac', icon: <Apple className="h-5 w-5" /> }
  ];

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tp('title')}</DialogTitle>
          <DialogDescription>{tp('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {options.map((o) => {
            const active = sel === o.id;
            const isDetected = detectedOs === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setSel(o.id)}
                className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                  active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  {o.icon}
                  <span className="font-medium">{osLabel(o.id)}</span>
                  {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                </div>
                {isDetected && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {tp('detected')}
                  </span>
                )}
                {/* Anteprima concreta di cosa cambia: scorciatoia + percorso. */}
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {tp('exShortcut', { s: shortcut(o.id, 'copy') })}
                  <br />
                  <span className="break-all font-mono text-[10px]">
                    {libraryLocations(o.id, 'rekordbox')[0]?.path}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {detectedOs !== sel && (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs">
            {tp('mismatch', { chosen: osLabel(sel), detected: osLabel(detectedOs) })}
          </p>
        )}

        <p className="text-xs text-muted-foreground">{tp('changeLater')}</p>

        <div className="flex justify-end">
          <Button onClick={() => confirmOs(sel)}>{tp('confirm', { os: osLabel(sel) })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
