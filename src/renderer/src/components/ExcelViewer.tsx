import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/misc';

interface ViewerData {
  columns: string[];
  rows: (string | number | null)[][];
  totalRows: number;
  sheetName: string;
}

const PAGE_SIZE = 200;
const DEFAULT_WIDTH = 140;
const MIN_WIDTH = 60;
const WIDTHS_KEY = 'reportViewer.colWidths';

/**
 * Anteprima di un report .xlsx dentro l'app (fase intermedia).
 * - righe paginate (mai il file intero in memoria del renderer);
 * - scroll orizzontale per le molte colonne;
 * - larghezza colonne regolabile con trascinamento, PERSISTITA (per nome
 *   colonna) nelle impostazioni e resettabile.
 */
export function ExcelViewer({ filePath }: { filePath: string }) {
  const [data, setData] = useState<ViewerData | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragState = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // Carica larghezze persistite una volta sola.
  useEffect(() => {
    window.crateforge.settings.get(WIDTHS_KEY).then((v) => {
      if (v) {
        try {
          setWidths(JSON.parse(v));
        } catch {
          // impostazione corrotta: si riparte dai default
        }
      }
    });
  }, []);

  useEffect(() => {
    setError(null);
    window.crateforge.report
      .view(filePath, page * PAGE_SIZE, PAGE_SIZE)
      .then(setData)
      .catch((err: unknown) => setError(String(err)));
  }, [filePath, page]);

  const persistWidths = (w: Record<string, number>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => window.crateforge.settings.set(WIDTHS_KEY, JSON.stringify(w)),
      400
    );
  };

  const onDragStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { col, startX: e.clientX, startW: widths[col] ?? DEFAULT_WIDTH };
    const onMove = (ev: MouseEvent) => {
      const s = dragState.current;
      if (!s) return;
      const w = Math.max(MIN_WIDTH, s.startW + (ev.clientX - s.startX));
      setWidths((prev) => {
        const next = { ...prev, [s.col]: w };
        persistWidths(next);
        return next;
      });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetWidths = useCallback(() => {
    setWidths({});
    window.crateforge.settings.set(WIDTHS_KEY, '{}');
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Impossibile leggere il file: {error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Lettura del file…</p>;

  const totalPages = Math.max(1, Math.ceil(data.totalRows / PAGE_SIZE));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {filePath} — foglio "{data.sheetName}", {data.totalRows.toLocaleString('it-IT')} righe
        </span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={resetWidths}>
          <RotateCcw /> Reimposta colonne
        </Button>
      </div>
      {/* overflow-x-auto: le molte colonne scorrono lateralmente */}
      <div className="max-h-[26rem] overflow-auto rounded-md border">
        <table className="text-xs" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {data.columns.map((c) => (
                <th
                  key={c}
                  className="relative select-none border-b border-r px-2 py-1.5 text-left font-medium last:border-r-0"
                  style={{ width: widths[c] ?? DEFAULT_WIDTH, minWidth: MIN_WIDTH }}
                >
                  <span className="block truncate">{c}</span>
                  {/* maniglia di ridimensionamento */}
                  <span
                    onMouseDown={(e) => onDragStart(c, e)}
                    className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize"
                    title="Trascina per ridimensionare"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-muted/30">
                {data.columns.map((c, ci) => (
                  <td
                    key={ci}
                    className="truncate border-b border-r px-2 py-1 last:border-r-0"
                    style={{ width: widths[c] ?? DEFAULT_WIDTH, maxWidth: widths[c] ?? DEFAULT_WIDTH }}
                    title={row[ci] === null ? '' : String(row[ci])}
                  >
                    {row[ci] === null ? '' : String(row[ci])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Precedenti
          </Button>
          Pagina {page + 1} di {totalPages}
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Successive →
          </Button>
        </div>
      )}
    </div>
  );
}
