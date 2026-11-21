import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,
    port: 5173,
    // FT_API lets several copies run side by side (each with its own API server)
    proxy: { '/api': process.env.FT_API ?? 'http://localhost:8787' },
  },
  // the QR decoder loads only when the camera opens; bundled ahead so the dev
  // server does not reload the page the first time it is needed. HarfBuzz (the
  // export's lettering) finds its .wasm next to itself, so it is left where it is
  optimizeDeps: { include: ['jsqr'], exclude: ['harfbuzzjs'] },
});
