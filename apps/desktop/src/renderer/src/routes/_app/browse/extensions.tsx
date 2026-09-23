import { createFileRoute } from '@tanstack/react-router';
import { Puzzle } from 'lucide-react';
import { PlaceholderPage } from '../../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/browse/extensions')({
  staticData: { crumbs: ['browse', 'extensions'] },
  component: () => <PlaceholderPage titleKey="extensions" emptyKey="extensions" icon={Puzzle} />,
});
