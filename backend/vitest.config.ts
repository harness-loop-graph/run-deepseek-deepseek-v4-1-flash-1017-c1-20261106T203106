import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
    pool: 'threads',
  },
});
