import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the production build can be served from any static path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // post-processing stays in its own lazily loaded chunk (High preset only)
          if (/node_modules\/(@react-three\/postprocessing|postprocessing|n8ao)\//.test(id)) return undefined;
          if (/node_modules\/three\//.test(id)) return 'three';
          if (/node_modules\/(@react-three|three-stdlib|troika|camera-controls|maath|meshline|zustand)/.test(id)) return 'r3f';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
