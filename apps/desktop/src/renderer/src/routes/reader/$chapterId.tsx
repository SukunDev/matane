import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, BookOpenText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { buttonVariants } from '../../components/ui/button';

// Full-screen layout without the app shell (BRAINSTORM.md §6.1). Filled in during Phase 1.
export const Route = createFileRoute('/reader/$chapterId')({
  component: ReaderPage,
});

function ReaderPage() {
  const { t } = useTranslation();
  return (
    <div className="h-full bg-ctp-crust">
      <EmptyState
        icon={BookOpenText}
        title={t('empty.reader.title')}
        description={t('empty.reader.description')}
        action={
          <Link to="/library" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft />
            {t('titlebar.back')}
          </Link>
        }
      />
    </div>
  );
}
