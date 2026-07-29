import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Locale } from './i18n';
import type { TargetOs } from '@core/platformProfile';

/**
 * Stato applicativo globale: tema (dark/light/auto), modalità utente
 * (Semplice/Esperto), lingua, profilo OS. Persistito nelle settings dell'UDM
 * via IPC.
 *
 * Profilo OS (§): scorciatoie, percorsi delle librerie DJ e comandi da
 * terminale sono diversi tra Windows e macOS. L'app RILEVA l'OS reale e lo
 * pre-seleziona, ma l'utente decide: `targetOs` è la scelta effettiva,
 * `detectedOs` resta esposto per poter dire "rilevato" nella UI e segnalare
 * quando la scelta diverge dalla macchina su cui si sta girando.
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
  /** OS scelto dall'utente: guida scorciatoie, percorsi e comandi mostrati. */
  targetOs: TargetOs;
  setTargetOs: (o: TargetOs) => void;
  /** OS realmente rilevato (null finché l'IPC non ha risposto). */
  detectedOs: TargetOs | null;
  /** false = la scelta iniziale non è ancora stata confermata dall'utente. */
  osChosen: boolean;
  confirmOs: (o: TargetOs) => void;
  /** true quando il profilo scelto non è quello della macchina corrente. */
  osMismatch: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [mode, setModeState] = useState<UserMode>('simple');
  const [locale, setLocaleState] = useState<Locale>('it');
  const [targetOs, setTargetOsState] = useState<TargetOs>('win');
  const [detectedOs, setDetectedOs] = useState<TargetOs | null>(null);
  const [osChosen, setOsChosen] = useState(true); // finché non so, non mostro nulla

  useEffect(() => {
    (async () => {
      const [t, m, l, os, chosen, plat] = await Promise.all([
        window.crateforge.settings.get('theme'),
        window.crateforge.settings.get('userMode'),
        window.crateforge.settings.get('locale'),
        window.crateforge.settings.get('targetOs'),
        window.crateforge.settings.get('osChosen'),
        window.crateforge.platform.detect()
      ]);
      if (t === 'light' || t === 'dark' || t === 'system') setThemeState(t);
      if (m === 'simple' || m === 'expert') setModeState(m);
      if (l === 'it' || l === 'en' || l === 'fr' || l === 'de') setLocaleState(l);
      setDetectedOs(plat.detected);
      // Preselezione: la scelta salvata se c'è, altrimenti l'OS rilevato.
      setTargetOsState(os === 'win' || os === 'mac' ? os : plat.detected);
      // Il dialog iniziale compare solo finché l'utente non ha confermato.
      setOsChosen(chosen === '1');
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
  const setTargetOs = (o: TargetOs) => {
    setTargetOsState(o);
    window.crateforge.settings.set('targetOs', o);
  };
  /** Conferma dal dialog iniziale: salva la scelta e non lo ripropone più. */
  const confirmOs = (o: TargetOs) => {
    setTargetOs(o);
    setOsChosen(true);
    window.crateforge.settings.set('osChosen', '1');
  };

  return (
    <Ctx.Provider
      value={{
        theme,
        setTheme,
        mode,
        setMode,
        locale,
        setLocale,
        targetOs,
        setTargetOs,
        detectedOs,
        osChosen,
        confirmOs,
        osMismatch: detectedOs !== null && detectedOs !== targetOs
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState fuori dal provider');
  return v;
}
