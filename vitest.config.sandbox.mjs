import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Sandbox variant: uses the threads pool (worker_threads) instead of the
// default forks pool, because the hermes sandbox blocks child-process spawning
// (spawn EPERM). worker_threads run in-process and are not blocked.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
