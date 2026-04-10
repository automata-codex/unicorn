import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    root: './',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
  plugins: [
    // SWC handles TypeScript + decorator metadata so NestJS DI works in tests.
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
