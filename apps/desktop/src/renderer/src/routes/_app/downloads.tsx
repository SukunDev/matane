import { createFileRoute } from '@tanstack/react-router';
import { DownloadsPage } from '../../features/downloads/DownloadsPage';

export const Route = createFileRoute('/_app/downloads')({
  staticData: { crumbs: ['downloads'] },
  component: DownloadsPage,
});
