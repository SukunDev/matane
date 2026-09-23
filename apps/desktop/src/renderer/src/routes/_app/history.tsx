import { createFileRoute } from '@tanstack/react-router';
import { History } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/history')({
  staticData: { crumbs: ['history'] },
  component: () => <PlaceholderPage titleKey="history" emptyKey="history" icon={History} />,
});
