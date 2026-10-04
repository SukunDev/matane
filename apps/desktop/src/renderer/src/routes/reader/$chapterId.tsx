import type { ChapterInfo } from '@manga-reader/shared';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { ReaderPage } from '../../features/reader/ReaderPage';
import { useReaderPosition } from '../../features/reader/store';

export interface ReaderSearch {
  /** Page to open (0-based) or "last" when coming back from the next chapter. */
  page?: number | 'last';
}

// Full-screen layout without the app shell (docs/BRAINSTORM.md §6.1).
export const Route = createFileRoute('/reader/$chapterId')({
  params: {
    parse: ({ chapterId }) => {
      const id = Number(chapterId);
      if (!Number.isInteger(id) || id <= 0) throw notFound();
      return { chapterId: String(id) };
    },
  },
  validateSearch: (search: Record<string, unknown>): ReaderSearch => {
    const page = search['page'];
    if (page === 'last') return { page };
    return typeof page === 'number' && Number.isInteger(page) && page >= 0 ? { page } : {};
  },
  component: ReaderRoute,
});

function ReaderRoute() {
  const { chapterId } = Route.useParams();
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();

  // A reading session restarts on explicit navigation (even back to the chapter it began with),
  // but not when the strip scrolls into another chapter and only moves the URL along.
  const followed = useReaderPosition((state) => state.followedChapterId);
  const [session, setSession] = useState({ chapterId, start: page, url: chapterId, count: 0 });
  if (chapterId !== session.url) {
    setSession(
      chapterId === followed
        ? { ...session, url: chapterId }
        : { chapterId, start: page, url: chapterId, count: session.count + 1 },
    );
  }

  const onVisibleChapter = useCallback(
    (chapter: ChapterInfo) => {
      // Set before navigating so the render that sees the new URL already knows it was followed.
      useReaderPosition.setState({ followedChapterId: String(chapter.id) });
      void navigate({ params: { chapterId: String(chapter.id) }, search: {}, replace: true });
    },
    [navigate],
  );

  return (
    <ReaderPage
      key={session.count}
      chapterId={Number(session.chapterId)}
      start={session.start}
      onVisibleChapter={onVisibleChapter}
    />
  );
}
