import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Shared development hosts can bound parallel checks without relaxing test deadlines.
    maxWorkers: process.env.VITEST_MAX_WORKERS ? Number(process.env.VITEST_MAX_WORKERS) : undefined,
    setupFiles: ['tests/home-isolation.ts', 'tests/snippet-isolation.ts', 'tests/provider-cli-isolation.ts', 'tests/caller-isolation.ts'],
    include: ['tests/**/*.test.{ts,mjs}'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
})
