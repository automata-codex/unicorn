import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scoped to the docs tooling on purpose. The workspaces run their own
    // suites through their own configs; a root `vitest` run that picked those
    // up would need the backend's SWC plugin and setup files.
    include: ['docs/tooling/**/*.spec.ts'],
    environment: 'node',
  },
});
