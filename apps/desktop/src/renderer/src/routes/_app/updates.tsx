import { createFileRoute } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/updates')({
  staticData: { crumbs: ['updates'] },
  component: () => <PlaceholderPage titleKey="updates" emptyKey="updates" icon={RefreshCw} />,
});
