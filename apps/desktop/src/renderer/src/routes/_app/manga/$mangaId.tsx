import { createFileRoute, notFound } from '@tanstack/react-router';
import { MangaDetailPage } from '../../../features/manga/MangaDetailPage';

export const Route = createFileRoute('/_app/manga/$mangaId')({
  params: {
    parse: ({ mangaId }) => {
      const id = Number(mangaId);
      if (!Number.isInteger(id) || id <= 0) throw notFound();
      return { mangaId: String(id) };
    },
  },
  component: MangaRoute,
});

function MangaRoute() {
  const { mangaId } = Route.useParams();
  return <MangaDetailPage key={mangaId} mangaId={Number(mangaId)} />;
}
