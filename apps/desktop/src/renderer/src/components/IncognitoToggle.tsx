import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIncognito } from '../lib/incognito';
import { cn } from '../lib/utils';

/**
 * Title bar and reader toggle. Off it is a quiet icon; on it stays visible as a labelled pill, so
 * incognito is never on by accident (mockups 03 and 10).
 */
export function IncognitoToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [on, setOn] = useIncognito();
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? t('incognito.turnOffHint') : t('incognito.turnOnHint')}
      onClick={() => setOn(!on)}
      className={cn(
        'no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
        on
          ? 'border border-ctp-peach/40 bg-ctp-peach/15 text-ctp-peach hover:bg-ctp-peach/25'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <EyeOff className="size-4" />
      {on && t('incognito.label')}
    </button>
  );
}
