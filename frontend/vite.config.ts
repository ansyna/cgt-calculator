import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development the Spring Boot API runs on :8080; requests to /api are proxied there. The browser's Host header is
// kept (Vite's short form would change it to :8080): the API then sees the request as coming from the page's own
// address, as in production, and its cross-origin check lets it through without CORS_ALLOWED_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8080', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // e2e/ holds the Playwright browser tests (npm run test:e2e)
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
