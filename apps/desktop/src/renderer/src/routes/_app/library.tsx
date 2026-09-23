import { createFileRoute } from '@tanstack/react-router';
import { LibraryBig } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/library')({
  staticData: { crumbs: ['library'] },
  component: () => <PlaceholderPage titleKey="library" emptyKey="library" icon={LibraryBig} />,
});
