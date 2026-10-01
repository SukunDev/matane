import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { CommandPalette } from '../../features/palette/CommandPalette';
import { WhatsNewDialog } from '../../features/whats-new/WhatsNewDialog';
import { usePalette } from '../../stores/palette';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function AppShell() {
  // Ctrl+K (⌘K on macOS) opens the command palette anywhere in the app shell, or closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const palette = usePalette.getState();
        palette.setOpen(!palette.open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <WhatsNewDialog />
    </div>
  );
}
