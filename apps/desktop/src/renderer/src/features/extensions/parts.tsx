import type { RepoTrust } from '@manga-reader/shared';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { SourceIcon } from '../browse/SourceIcon';

/** The extension's icon.png, or its initials when it has none (or it fails to load). */
export function ExtensionIcon(props: { id: string; name: string; src: string | null; className?: string }) {
  return <SourceIcon {...props} />;
}

/** "Verified" / "Trusted key" / "Unverified" for a repository. */
export function TrustBadge({ trust }: { trust: RepoTrust }) {
  const { t } = useTranslation();
  if (trust === 'official') return <Badge variant="success">{t('extensions.trust.verified')}</Badge>;
  if (trust === 'trusted') return <Badge variant="info">{t('extensions.trust.trustedKey')}</Badge>;
  return <Badge variant="warning">{t('extensions.trust.unverified')}</Badge>;
}

/** "Official · Verified" (green), "<repo> · Trusted key", "<repo> · Unverified" (yellow). */
export function TrustLine({ trust, repoName }: { trust: RepoTrust; repoName: string }) {
  const { t } = useTranslation();
  if (trust === 'official') {
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-ctp-green">
        <ShieldCheck className="size-3.5" />
        {t('extensions.trust.officialLine')}
      </span>
    );
  }
  if (trust === 'trusted') {
    return (
      <span className="flex max-w-[60%] min-w-0 shrink-0 items-center gap-1 text-ctp-blue">
        <Shield className="size-3.5 shrink-0" />
        <span className="truncate">{t('extensions.trust.trustedLine', { repo: repoName })}</span>
      </span>
    );
  }
  return (
    <span className="flex max-w-[60%] min-w-0 shrink-0 items-center gap-1 text-ctp-yellow">
      <ShieldAlert className="size-3.5 shrink-0" />
      <span className="truncate">{t('extensions.trust.unverifiedLine', { repo: repoName })}</span>
    </span>
  );
}

/** Up to three language badges, then "+n". */
export function LangBadges({ langs }: { langs: string[] }) {
  const shown = langs.slice(0, 3);
  return (
    <>
      {shown.map((lang) => (
        <Badge key={lang}>{lang.toUpperCase()}</Badge>
      ))}
      {langs.length > shown.length && <Badge variant="outline">+{langs.length - shown.length}</Badge>}
    </>
  );
}
