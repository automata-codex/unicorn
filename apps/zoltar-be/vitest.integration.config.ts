import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    root: './',
    include: [
      'src/**/*.spec-int.ts',
      'scripts/**/*.spec-int.ts',
      'eval/**/*.spec-int.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // Must run (and complete) before any test file's own imports — see
    // vitest-integration-setup.ts for why: ConfigModule.forRoot() bakes
    // DATABASE_URL in at Node's first import of config.module.ts, not per
    // TestingModule.compile() call, so a test file setting process.env
    // itself is always too late once it has imported anything that
    // transitively pulls in AppModule.
    setupFiles: ['./test/vitest-integration-setup.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
