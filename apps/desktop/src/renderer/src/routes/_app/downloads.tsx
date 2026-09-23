import { createFileRoute } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/downloads')({
  staticData: { crumbs: ['downloads'] },
  component: () => <PlaceholderPage titleKey="downloads" emptyKey="downloads" icon={Download} />,
});
