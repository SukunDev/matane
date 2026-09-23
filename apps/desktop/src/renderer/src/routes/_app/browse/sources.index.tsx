import { createFileRoute } from '@tanstack/react-router';
import { SourcesPage } from '../../../features/browse/SourcesPage';

export const Route = createFileRoute('/_app/browse/sources/')({
  staticData: { crumbs: ['browse', 'sources'] },
  component: SourcesPage,
});
