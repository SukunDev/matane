import { createFileRoute } from '@tanstack/react-router';
import { UpdatesPage } from '../../features/updates/UpdatesPage';

export const Route = createFileRoute('/_app/updates')({
  staticData: { crumbs: ['updates'] },
  component: UpdatesPage,
});
