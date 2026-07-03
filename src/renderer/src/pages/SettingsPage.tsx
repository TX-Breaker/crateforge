import { useEffect, useState } from 'react';
import { KeyRound, Moon, Sun, SunMoon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle, Input, Label, Switch } from '@/components/ui/misc';
import { useAppState, type Theme } from '@/lib/appState';
import { LOCALES } from '@/lib/i18n';
import { pageText } from '@/lib/i18nPages';

/**
 * Impostazioni: tema, lingua, modalità Semplice/Esperto (§5).
 * La modalità Esperto sblocca le funzioni avanzate, ognuna con disclaimer.
 */
export function SettingsPage() {
  const { theme, setTheme, mode, setMode, locale, setLocale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'settings', k, p);
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
      setKeyMsg(r.ok ? tp('keyOk') : tp('keyFail', { msg: r.message ?? '?' }));
    } finally {
      setKeyBusy(false);
    }
  };

  const themes: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: tp('themeLight'), icon: <Sun /> },
    { id: 'dark', label: tp('themeDark'), icon: <Moon /> },
    { id: 'system', label: tp('themeAuto'), icon: <SunMoon /> }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tp('appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{tp('themeLabel')}</Label>
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
            <Label>{tp('langLabel')}</Label>
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
          <CardTitle>{tp('modeTitle')}</CardTitle>
          <CardDescription>{tp('modeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between text-sm">
            <span>
              <Label>{tp('expertLabel')}</Label>
              <p className="text-xs text-muted-foreground">{tp('expertDesc')}</p>
            </span>
            <Switch
              checked={mode === 'expert'}
              onCheckedChange={(v) => setMode(v ? 'expert' : 'simple')}
            />
          </label>
          {mode === 'expert' && (
            <Alert variant="warning">
              <AlertTitle>{tp('expertOnTitle')}</AlertTitle>
              <AlertDescription>{tp('expertOnBody')}</AlertDescription>
            </Alert>
          )}
          {mode === 'expert' && (
            <>
              <label className="flex items-center justify-between border-t pt-3 text-sm">
                <span>
                  <Label>{tp('directLabel')}</Label>
                  <p className="text-xs text-muted-foreground">{tp('directDesc')}</p>
                </span>
                <Switch checked={directWrites} onCheckedChange={toggleDirectWrites} />
              </label>
              {directWrites && (
                <Alert variant="destructive">
                  <AlertTitle>{tp('directOnTitle')}</AlertTitle>
                  <AlertDescription>{tp('directOnBody')}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5 border-t pt-3">
                <Label>{tp('discogsLabel')}</Label>
                <p className="text-xs text-muted-foreground">{tp('discogsDesc')}</p>
                <Input
                  type="password"
                  value={discogsToken}
                  placeholder={tp('discogsPh')}
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
          <CardTitle>{tp('sidecarTitle')}</CardTitle>
          <CardDescription>{tp('sidecarDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sidecar === null ? (
            <p className="text-sm text-muted-foreground">{tp('checking')}</p>
          ) : sidecar.available ? (
            <div className="space-y-3">
              <p className="text-sm">
                {tp('available')}{' '}
                <span className="font-mono text-xs text-muted-foreground">{sidecar.binaryPath}</span>
              </p>
              {mode === 'expert' && (
                <div className="space-y-2 border-t pt-3">
                  <Label>{tp('keyLabel')}</Label>
                  <p className="text-xs text-muted-foreground">{tp('keyDesc')}</p>
                  <Button variant="outline" size="sm" onClick={doDownloadKey} disabled={keyBusy}>
                    <KeyRound /> {tp('keyBtn')}
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
              <AlertTitle>{tp('unavailTitle')}</AlertTitle>
              <AlertDescription>{tp('unavailBody')}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
