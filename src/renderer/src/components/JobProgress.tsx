import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/misc';

interface ProgressState {
  phase: string;
  done: number;
  total: number;
}

/**
 * Barra di avanzamento job: ascolta gli eventi IPC (già throttlati lato main).
 */
export function useJobProgress(): ProgressState | null {
  const [state, setState] = useState<ProgressState | null>(null);
  useEffect(() => {
    const off = window.crateforge.jobs.onProgress((p) => {
      setState({ phase: p.phase, done: p.done, total: p.total });
    });
    return off;
  }, []);
  return state;
}

const PHASE_LABELS: Record<string, string> = {
  scan: 'Scansione file…',
  copy: 'Copia in corso…',
  'ingest-xml': 'Importazione libreria (XML)…',
  'ingest-masterdb': 'Lettura database Rekordbox…',
  'orphan-scan': 'Ricerca file orfani…',
  excel: 'Generazione report…',
  'relocate-scan': 'Ricerca nella nuova cartella…'
};

export function JobProgressBar({ active }: { active: boolean }) {
  const p = useJobProgress();
  if (!active || !p) return null;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{PHASE_LABELS[p.phase] ?? p.phase}</span>
        <span>{pct !== undefined ? `${pct}%` : `${p.done.toLocaleString('it-IT')} file`}</span>
      </div>
      <Progress value={pct ?? 30} className={pct === undefined ? 'animate-pulse' : ''} />
    </div>
  );
}
