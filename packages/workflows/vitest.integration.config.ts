import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // These integration files intentionally exercise the production queue names.
    // Run them one file at a time so a Worker from another test cannot consume the Job.
    fileParallelism: false,
  },
});
