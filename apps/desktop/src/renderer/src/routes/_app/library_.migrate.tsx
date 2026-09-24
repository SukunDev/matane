import { createFileRoute } from '@tanstack/react-router';
import { MigrationPage } from '../../features/migration/MigrationPage';

export interface MigrateSearch {
  /** Library manga to migrate. */
  ids: number[];
}

export const Route = createFileRoute('/_app/library_/migrate')({
  staticData: { crumbs: ['library', 'migrate'] },
  validateSearch: (search: Record<string, unknown>): MigrateSearch => ({
    ids: Array.isArray(search['ids'])
      ? [...new Set(search['ids'].filter((id): id is number => Number.isInteger(id) && id > 0))]
      : [],
  }),
  component: MigrateRoute,
});

function MigrateRoute() {
  const { ids } = Route.useSearch();
  // A new selection starts over (choices, results).
  return <MigrationPage key={ids.join(',')} ids={ids} />;
}
