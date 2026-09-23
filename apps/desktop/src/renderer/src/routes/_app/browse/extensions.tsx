import { createFileRoute } from '@tanstack/react-router';
import { ExtensionsPage } from '../../../features/extensions/ExtensionsPage';

export const Route = createFileRoute('/_app/browse/extensions')({
  staticData: { crumbs: ['browse', 'extensions'] },
  component: ExtensionsPage,
});
