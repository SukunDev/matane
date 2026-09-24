import { createFileRoute } from '@tanstack/react-router';
import { HistoryPage } from '../../features/history/HistoryPage';

export const Route = createFileRoute('/_app/history')({
  staticData: { crumbs: ['history'] },
  component: HistoryPage,
});
