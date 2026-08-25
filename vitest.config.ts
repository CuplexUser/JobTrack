import { defineConfig } from 'vitest/config';

/**
 * One command runs all three workspaces. Each project keeps its own environment: the
 * shared and API suites are plain Node, the web suite needs jsdom.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
        },
      },
    ],
  },
});
