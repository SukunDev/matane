import { createFileRoute } from '@tanstack/react-router';
import { Bookmark } from 'lucide-react';
import { PlaceholderPage } from '../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/bookmarks')({
  staticData: { crumbs: ['bookmarks'] },
  component: () => <PlaceholderPage titleKey="bookmarks" emptyKey="bookmarks" icon={Bookmark} />,
});
