import { useEffect, useState } from 'react';
import { KeyRound, Moon, Sun, SunMoon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label, Switch } from '@/components/ui/misc';
import { useAppState, type Theme } from '@/lib/appState';
import { LOCALES } from '@/lib/i18n';

/**
 * Impostazioni: tema, lingua, modalità Semplice/Esperto (§5).
 * La modalità Esperto sblocca le funzioni avanzate, ognuna con disclaimer.
 */
export function SettingsPage() {
  const { theme, setTheme, mode, setMode, locale, setLocale } = useAppState();
  const [sidecar, setSidecar] = useState<{ available: boolean; binaryPath?: string } | null>(null);
  const [directWrites, setDirectWrites] = useState(false);
  const [discogsToken, setDiscogsToken] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  useEffect(() => {
    window.crateforge.sidecar.check().then(setSidecar);
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    window.crateforge.settings.get('discogsToken').then((v) => setDiscogsToken(v ?? ''));
  }, []);

  const toggleDirectWrites = (v: boolean) => {
    setDirectWrites(v);
    window.crateforge.settings.set('directWrites', v ? '1' : '0');
  };

  const doDownloadKey = async () => {
    setKeyBusy(true);
    setKeyMsg(null);
    try {
      const r = await window.crateforge.sidecar.downloadKey();
      setKeyMsg(
        r.ok
          ? 'Chiave scaricata e salvata: la lettura diretta del master.db ora dovrebbe funzionare (riprova l\'importazione dalla Panoramica).'
          : `Non riuscito: ${r.message}`
      );
    } finally {
      setKeyBusy(false);
    }
  };

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
              {LOCALES.map((l) => (
                <Button
                  key={l.id}
                  variant={locale === l.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLocale(l.id)}
                >
                  {l.label}
                </Button>
              ))}
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
                Le funzioni avanzate lavorano di default su copie e database interno. Le scritture
                sui file originali restano SPENTE finché non le attivi qui sotto, e ogni singola
                operazione richiede comunque doppia conferma.
              </AlertDescription>
            </Alert>
          )}
          {mode === 'expert' && (
            <>
              <label className="flex items-center justify-between border-t pt-3 text-sm">
                <span>
                  <Label>Scritture dirette sui file originali</Label>
                  <p className="text-xs text-muted-foreground">
                    Sblocca: eliminazione definitiva degli orfani, scrittura dei tag ID3 sui file
                    audio originali (con backup verificato e rollback automatico)
                  </p>
                </span>
                <Switch checked={directWrites} onCheckedChange={toggleDirectWrites} />
              </label>
              {directWrites && (
                <Alert variant="destructive">
                  <AlertTitle>Scritture dirette ATTIVE</AlertTitle>
                  <AlertDescription>
                    CrateForge ora può modificare o eliminare i tuoi file originali dove lo
                    chiedi esplicitamente. Ogni operazione fa prima un backup verificato con hash
                    e fa rollback automatico in caso di anomalia — ma un'eliminazione definitiva
                    resta definitiva. Il database di Rekordbox (master.db) NON viene comunque mai
                    scritto: è cifrato e con schema non documentato, un errore lì significa
                    perdere la libreria. Verso Rekordbox si passa sempre dall'XML.
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5 border-t pt-3">
                <Label>Token Discogs (Auto-Tagger, opzionale)</Label>
                <p className="text-xs text-muted-foreground">
                  Token personale gratuito da discogs.com → Settings → Developers. Serve solo se
                  scegli Discogs come provider nell'Auto-Tagger.
                </p>
                <Input
                  type="password"
                  value={discogsToken}
                  placeholder="Il tuo token Discogs"
                  onChange={(e) => {
                    setDiscogsToken(e.target.value);
                    window.crateforge.settings.set('discogsToken', e.target.value);
                  }}
                />
              </div>
            </>
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
            <div className="space-y-3">
              <p className="text-sm">
                ✅ Disponibile{' '}
                <span className="font-mono text-xs text-muted-foreground">{sidecar.binaryPath}</span>
              </p>
              {mode === 'expert' && (
                <div className="space-y-2 border-t pt-3">
                  <Label>La lettura del master.db fallisce? (Rekordbox ≥ 6.6.5)</Label>
                  <p className="text-xs text-muted-foreground">
                    Da Rekordbox 6.6.5 la chiave di decrittazione non è più estraibile in locale.
                    Questo pulsante la recupera dalle fonti pubbliche del progetto pyrekordbox e
                    la salva sul tuo computer. Non viene inviato alcun tuo dato; serve solo una
                    connessione internet.
                  </p>
                  <Button variant="outline" size="sm" onClick={doDownloadKey} disabled={keyBusy}>
                    <KeyRound /> Scarica chiave di lettura
                  </Button>
                  {keyMsg && (
                    <Alert>
                      <AlertDescription>{keyMsg}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
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
