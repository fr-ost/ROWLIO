import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@brand': path.resolve(import.meta.dirname, 'brand.config.json'),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  define: {
    __E2E__: 'false',
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    environmentOptions: {
      jsdom: { url: 'https://example.test/shop/list?page=1' },
    },
  },
});
