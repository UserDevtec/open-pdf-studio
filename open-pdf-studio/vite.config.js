import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [solidPlugin()],
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
  server: {
    port: 3041,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3041,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 6000 },
});
