import { Card, CardContent } from '@/components/ui/card';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import logoUrl from '../../../../assets/branding/rekordbox-dj-italia-logo.svg';

/**
 * Schermata Info/About (§5, §12.5): logo placeholder (sostituibile in
 * assets/branding/) + credito.
 */
export function AboutPage() {
  const { locale } = useAppState();
  const tp = (k: string) => pageText(locale, 'about', k);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tp('title')}</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <img src={logoUrl} alt="Rekordbox DJ Italia Group" className="h-24 w-24" />
          <div>
            <div className="text-xl font-bold">CrateForge</div>
            <div className="text-sm text-muted-foreground">{tp('tagline')}</div>
          </div>
          <p className="text-sm">{tp('credit')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{tp('disclaimer')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
