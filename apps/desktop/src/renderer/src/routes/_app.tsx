import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell';
import { settingsQuery } from '../lib/ipc';

export const Route = createFileRoute('/_app')({
  // A new profile goes through the first-run setup first (docs/BRAINSTORM.md §6.6).
  beforeLoad: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQuery);
    if (!settings.onboarding.done) throw redirect({ to: '/onboarding' });
  },
  component: AppShell,
});
