import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development the Spring Boot API runs on :8080; requests to /api are proxied there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // e2e/ holds the Playwright browser tests (npm run test:e2e)
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
