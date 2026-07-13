import { Sparkles } from 'lucide-react';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

/**
 * Nota inline "rispetto a Rekordbox": spiega, per ogni funzione, la differenza
 * col comportamento nativo di Rekordbox e il beneficio di CrateForge (es.
 * backup incrementale vs backup completo). Testo per pagina in i18nPages,
 * namespace `rbdiff`.
 */
export function RekordboxDiff({ page }: { page: string }) {
  const { locale } = useAppState();
  const text = pageText(locale, 'rbdiff', page);
  if (!text || text === page) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span>
        <span className="font-medium text-foreground">
          {pageText(locale, 'rbdiff', 'label')}:
        </span>{' '}
        {text}
      </span>
    </div>
  );
}
