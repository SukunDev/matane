import { createFileRoute } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { PlaceholderPage } from '../../../components/PlaceholderPage';

export const Route = createFileRoute('/_app/manga/$mangaId')({
  staticData: { crumbs: ['library', 'manga'] },
  component: () => <PlaceholderPage titleKey="manga" emptyKey="manga" icon={BookOpen} />,
});
