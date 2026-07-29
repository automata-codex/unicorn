import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    root: './',
    include: ['src/**/*.spec.ts', 'eval/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    exclude: ['src/**/*.spec-int.ts', 'eval/**/*.spec-int.ts'],
    environment: 'node',
    // Strips real secrets before any test file's imports resolve, so a unit
    // test that accidentally reaches AppModule's eager env validation fails
    // the same way locally as it does in CI — see the file for why.
    setupFiles: ['./test/vitest-unit-setup.ts'],
  },
  plugins: [
    // SWC handles TypeScript + decorator metadata so NestJS DI works in tests.
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
