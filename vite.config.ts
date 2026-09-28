import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from a sub-path on GitHub Pages (https://<user>.github.io/<repo>/); '/' locally.
  base: process.env.KEYFALL_BASE ?? '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
