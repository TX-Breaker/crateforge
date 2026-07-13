import { useState } from 'react';
import {
  AudioLines,
  FileEdit,
  FileWarning,
  Fingerprint,
  FolderSync,
  Globe,
  HardDriveDownload,
  HeartPulse,
  Home,
  Info,
  MapPin,
  Receipt,
  Repeat,
  Route,
  ScrollText,
  Settings,
  Sheet,
  Sparkles,
  Wand2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { t, type MsgKey } from '@/lib/i18n';
import { Badge } from '@/components/ui/misc';
import { Dashboard } from '@/pages/Dashboard';
import { HealthPage } from '@/pages/HealthPage';
import { SetBuilderPage } from '@/pages/SetBuilderPage';
import { BackupPage } from '@/pages/BackupPage';
import { OrphansPage } from '@/pages/OrphansPage';
import { ReportPage } from '@/pages/ReportPage';
import { ConverterPage } from '@/pages/ConverterPage';
import { RelocatorPage } from '@/pages/RelocatorPage';
import { DedupPage } from '@/pages/DedupPage';
import { AutoCuePage } from '@/pages/AutoCuePage';
import { TaggerPage } from '@/pages/TaggerPage';
import { StemsPage } from '@/pages/StemsPage';
import { InboxPage } from '@/pages/InboxPage';
import { PlannerPage } from '@/pages/PlannerPage';
import { SiaePage } from '@/pages/SiaePage';
import { ReviewPage } from '@/pages/ReviewPage';
import { LogPage } from '@/pages/LogPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AboutPage } from '@/pages/AboutPage';

type PageId =
  | 'dashboard'
  | 'health'
  | 'setbuilder'
  | 'backup'
  | 'orphans'
  | 'report'
  | 'converter'
  | 'relocator'
  | 'dedup'
  | 'autocue'
  | 'tagger'
  | 'stems'
  | 'inbox'
  | 'planner'
  | 'siae'
  | 'review'
  | 'log'
  | 'settings'
  | 'about';

interface NavItem {
  id: PageId;
  labelKey: MsgKey;
  icon: React.ReactNode;
  /** true = visibile solo in modalità Esperto */
  expertOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <Home /> },
  { id: 'health', labelKey: 'nav.health', icon: <HeartPulse /> },
  { id: 'backup', labelKey: 'nav.backup', icon: <HardDriveDownload /> },
  { id: 'orphans', labelKey: 'nav.orphans', icon: <FileWarning /> },
  { id: 'report', labelKey: 'nav.report', icon: <Sheet /> },
  { id: 'siae', labelKey: 'nav.siae', icon: <Receipt /> },
  { id: 'converter', labelKey: 'nav.converter', icon: <Repeat /> },
  { id: 'relocator', labelKey: 'nav.relocator', icon: <MapPin />, expertOnly: true },
  { id: 'dedup', labelKey: 'nav.dedup', icon: <Fingerprint />, expertOnly: true },
  { id: 'autocue', labelKey: 'nav.autocue', icon: <Wand2 />, expertOnly: true },
  { id: 'tagger', labelKey: 'nav.tagger', icon: <Globe />, expertOnly: true },
  { id: 'stems', labelKey: 'nav.stems', icon: <AudioLines />, expertOnly: true },
  { id: 'inbox', labelKey: 'nav.inbox', icon: <FolderSync />, expertOnly: true },
  { id: 'planner', labelKey: 'nav.planner', icon: <Route />, expertOnly: true },
  { id: 'setbuilder', labelKey: 'nav.setbuilder', icon: <Sparkles />, expertOnly: true },
  { id: 'review', labelKey: 'nav.review', icon: <FileEdit /> },
  { id: 'log', labelKey: 'nav.log', icon: <ScrollText /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings /> },
  { id: 'about', labelKey: 'nav.about', icon: <Info /> }
];

/**
 * Shell dell'app: sidebar di navigazione + pagina attiva.
 * In modalità Semplice le voci avanzate (expertOnly) sono nascoste (§5).
 */
export function App() {
  const { mode, locale } = useAppState();
  const [page, setPage] = useState<PageId>('dashboard');

  const visible = NAV.filter((n) => !n.expertOnly || mode === 'expert');
  // Se si torna in Semplice mentre si è su una pagina Esperto, rientra in Panoramica.
  const active = visible.some((n) => n.id === page) ? page : 'dashboard';

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2 px-4 pb-2 pt-5">
          <span className="text-lg font-bold tracking-tight">CrateForge</span>
          <Badge variant={mode === 'expert' ? 'destructive' : 'secondary'} className="text-[10px]">
            {t(locale, mode === 'expert' ? 'mode.expert' : 'mode.simple')}
          </Badge>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {visible.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors [&_svg]:h-4 [&_svg]:w-4',
                active === n.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {n.icon}
              {t(locale, n.labelKey)}
            </button>
          ))}
        </nav>
        <div className="border-t px-4 py-3 text-[10px] leading-tight text-muted-foreground">
          {t(locale, 'safety.readonly')}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {active === 'dashboard' && <Dashboard />}
        {active === 'health' && <HealthPage />}
        {active === 'setbuilder' && <SetBuilderPage />}
        {active === 'backup' && <BackupPage />}
        {active === 'orphans' && <OrphansPage />}
        {active === 'report' && <ReportPage />}
        {active === 'converter' && <ConverterPage />}
        {active === 'relocator' && <RelocatorPage />}
        {active === 'dedup' && <DedupPage />}
        {active === 'autocue' && <AutoCuePage />}
        {active === 'tagger' && <TaggerPage />}
        {active === 'stems' && <StemsPage />}
        {active === 'inbox' && <InboxPage />}
        {active === 'planner' && <PlannerPage />}
        {active === 'siae' && <SiaePage />}
        {active === 'review' && <ReviewPage />}
        {active === 'log' && <LogPage />}
        {active === 'settings' && <SettingsPage />}
        {active === 'about' && <AboutPage />}
      </main>
    </div>
  );
}
