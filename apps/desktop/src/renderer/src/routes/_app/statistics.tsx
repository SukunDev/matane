import { createFileRoute } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/statistics')({
  staticData: { crumbs: ['statistics'] },
  component: () => <PlaceholderPage titleKey="statistics" emptyKey="statistics" icon={ChartColumn} />,
});
