import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-three',
                test: /node_modules[\\/]three[\\/]/,
                priority: 40,
              },
              {
                name: 'vendor-r3f',
                test: /node_modules[\\/](@react-three[\\/](fiber|drei)|three-stdlib|maath|camera-controls|meshline|troika-three-text|suspend-react|its-fine)/,
                priority: 30,
              },
              {
                name: 'vendor-motion',
                test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)/,
                priority: 20,
              },
              {
                name: 'vendor-supabase',
                test: /node_modules[\\/]@supabase[\\/]/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
