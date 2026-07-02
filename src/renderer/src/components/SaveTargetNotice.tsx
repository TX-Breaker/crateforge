import { Database, FileWarning, FileOutput, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { t } from '@/lib/i18n';

export type SaveTarget = 'udm' | 'copy' | 'original' | 'xml';

/**
 * Badge che dichiara SEMPRE dove è finito un salvataggio (fase intermedia):
 * database interno (copia di lavoro), copia su disco, XML da importare o —
 * caso opt-in — file originali. Da mostrare accanto a ogni esito.
 */
export function SaveTargetNotice({ target }: { target: SaveTarget }) {
  const { locale } = useAppState();
  const map = {
    udm: { key: 'target.udm' as const, icon: <Database className="h-3 w-3" />, variant: 'secondary' as const },
    copy: { key: 'target.copy' as const, icon: <Copy className="h-3 w-3" />, variant: 'secondary' as const },
    xml: { key: 'target.xml' as const, icon: <FileOutput className="h-3 w-3" />, variant: 'secondary' as const },
    original: { key: 'target.original' as const, icon: <FileWarning className="h-3 w-3" />, variant: 'destructive' as const }
  };
  const m = map[target];
  return (
    <Badge variant={m.variant} className="gap-1.5 font-normal">
      {m.icon} {t(locale, m.key)}
    </Badge>
  );
}
