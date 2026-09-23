import { createFileRoute } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { PlaceholderPage } from '../../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/browse/sources')({
  staticData: { crumbs: ['browse', 'sources'] },
  component: () => <PlaceholderPage titleKey="sources" emptyKey="sources" icon={Globe} />,
});
