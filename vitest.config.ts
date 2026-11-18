import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node — no Electron, no browser. Media APIs are faked per test.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'shared/**/*.test.ts'],
    // `npm run coverage`. Every source file counts, the ones no test loads included: a number that left those out
    // would say how well the tested part is tested, not how much of Lumen is.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/editor/test-helpers.ts', 'src/editor/test-invariants.ts', 'src/locales/**', 'electron/locales/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})
