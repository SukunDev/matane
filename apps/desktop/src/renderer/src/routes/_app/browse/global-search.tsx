import { createFileRoute } from '@tanstack/react-router';
import { ScanSearch } from 'lucide-react';
import { PlaceholderPage } from '../../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/browse/global-search')({
  staticData: { crumbs: ['browse', 'globalSearch'] },
  component: () => <PlaceholderPage titleKey="globalSearch" emptyKey="globalSearch" icon={ScanSearch} />,
});
