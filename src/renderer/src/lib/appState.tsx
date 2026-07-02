import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Locale } from './i18n';

/**
 * Stato applicativo globale: tema (dark/light/auto), modalità utente
 * (Semplice/Esperto), lingua. Persistito nelle settings dell'UDM via IPC.
 */

export type Theme = 'light' | 'dark' | 'system';
export type UserMode = 'simple' | 'expert';

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  mode: UserMode;
  setMode: (m: UserMode) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [mode, setModeState] = useState<UserMode>('simple');
  const [locale, setLocaleState] = useState<Locale>('it');

  useEffect(() => {
    (async () => {
      const [t, m, l] = await Promise.all([
        window.crateforge.settings.get('theme'),
        window.crateforge.settings.get('userMode'),
        window.crateforge.settings.get('locale')
      ]);
      if (t === 'light' || t === 'dark' || t === 'system') setThemeState(t);
      if (m === 'simple' || m === 'expert') setModeState(m);
      if (l === 'it' || l === 'en' || l === 'fr' || l === 'de') setLocaleState(l);
    })();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    window.crateforge.settings.set('theme', t);
  };
  const setMode = (m: UserMode) => {
    setModeState(m);
    window.crateforge.settings.set('userMode', m);
  };
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    window.crateforge.settings.set('locale', l);
  };

  return (
    <Ctx.Provider value={{ theme, setTheme, mode, setMode, locale, setLocale }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState fuori dal provider');
  return v;
}
