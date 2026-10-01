import { createFileRoute } from '@tanstack/react-router';
import { StatisticsPage } from '../../features/statistics/StatisticsPage';

export const Route = createFileRoute('/_app/statistics')({
  staticData: { crumbs: ['statistics'] },
  component: StatisticsPage,
});
