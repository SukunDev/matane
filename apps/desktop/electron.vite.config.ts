import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages ship TypeScript sources, so they must be bundled instead of externalized.
const bundledWorkspaceDeps = ['@manga-reader/shared'];

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: bundledWorkspaceDeps } },
  },
  preload: {
    // Sandboxed preloads cannot require node_modules, so bundle everything. There is a single
    // entry, so no code splitting happens (`isolatedEntries` is unnecessary and crashes on non-TTY output).
    build: { externalizeDeps: false },
  },
  renderer: {
    // Main and preload stay unminified for readable stack traces; the renderer ships minified.
    build: { minify: true },
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve(__dirname, 'src/renderer/src/routes'),
        generatedRouteTree: resolve(__dirname, 'src/renderer/src/routeTree.gen.ts'),
      }),
      react(),
      tailwindcss(),
    ],
  },
});
