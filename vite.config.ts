import { defineConfig } from 'vite';

// assets/ wird unverändert ausgeliefert (Grafiken separat austauschbar),
// data/ wird beim Bauen eingebunden.
export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: { assetsDir: 'js' },
  server: { host: true },
});
