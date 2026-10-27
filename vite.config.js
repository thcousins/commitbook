import { defineConfig } from 'vite';

// `base: './'` makes the built app work from any folder or subdomain
// (GitHub Pages project sites, a cPanel subfolder, or a domain root).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 3000,
  },
});
