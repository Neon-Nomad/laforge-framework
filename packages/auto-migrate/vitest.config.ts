import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    environment: 'node',
    mockReset: false,
    restoreMocks: true,
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@auto-migrate': resolve(rootDir, 'src'),
    },
  },
});
