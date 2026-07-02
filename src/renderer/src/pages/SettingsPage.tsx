import { useEffect, useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Label, Switch } from '@/components/ui/misc';
import { useAppState, type Theme } from '@/lib/appState';

/**
 * Impostazioni: tema, lingua, modalità Semplice/Esperto (§5).
 * La modalità Esperto sblocca le funzioni avanzate, ognuna con disclaimer.
 */
export function SettingsPage() {
  const { theme, setTheme, mode, setMode, locale, setLocale } = useAppState();
  const [sidecar, setSidecar] = useState<{ available: boolean; binaryPath?: string } | null>(null);

  useEffect(() => {
    window.crateforge.sidecar.check().then(setSidecar);
  }, []);

  const themes: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: 'Chiaro', icon: <Sun /> },
    { id: 'dark', label: 'Scuro', icon: <Moon /> },
    { id: 'system', label: 'Automatico', icon: <SunMoon /> }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aspetto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tema</Label>
            <div className="flex gap-2">
              {themes.map((t) => (
                <Button
                  key={t.id}
                  variant={theme === t.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme(t.id)}
                >
                  {t.icon} {t.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Lingua / Language</Label>
            <div className="flex gap-2">
              <Button
                variant={locale === 'it' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocale('it')}
              >
                Italiano
              </Button>
              <Button
                variant={locale === 'en' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocale('en')}
              >
                English
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modalità utente</CardTitle>
          <CardDescription>
            In modalità Semplice vedi solo le operazioni sicure e guidate. La modalità Esperto
            sblocca le funzioni avanzate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between text-sm">
            <span>
              <Label>Modalità Esperto</Label>
              <p className="text-xs text-muted-foreground">
                Sblocca: relocator, lettura diretta master.db, opzioni avanzate future
              </p>
            </span>
            <Switch
              checked={mode === 'expert'}
              onCheckedChange={(v) => setMode(v ? 'expert' : 'simple')}
            />
          </label>
          {mode === 'expert' && (
            <Alert variant="warning">
              <AlertTitle>Sei in modalità Esperto</AlertTitle>
              <AlertDescription>
                Le funzioni avanzate restano sicure (mai scritture sugli originali), ma richiedono
                più attenzione: leggi sempre gli avvisi prima di procedere.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modulo di lettura diretta (sidecar)</CardTitle>
          <CardDescription>
            Componente che legge il database Rekordbox senza passare dall'export XML.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sidecar === null ? (
            <p className="text-sm text-muted-foreground">Verifica in corso…</p>
          ) : sidecar.available ? (
            <p className="text-sm">
              ✅ Disponibile{' '}
              <span className="font-mono text-xs text-muted-foreground">{sidecar.binaryPath}</span>
            </p>
          ) : (
            <Alert variant="warning">
              <AlertTitle>Non disponibile — modalità solo-XML attiva</AlertTitle>
              <AlertDescription>
                Su Windows la causa tipica è l'antivirus che mette in quarantena il modulo
                (falso positivo, comune per componenti impacchettati con PyInstaller). Apri
                Sicurezza di Windows → Protezione da virus e minacce → Cronologia protezione,
                ripristina il file e aggiungi la cartella di CrateForge alle esclusioni. Tutte le
                funzioni restano usabili importando la collection XML esportata da Rekordbox.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
