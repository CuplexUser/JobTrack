import { defineConfig } from 'vitest/config';

/**
 * One command runs every workspace's suite. Each project keeps its own environment: the
 * shared, API and MCP suites are plain Node, the web suite needs jsdom.
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
          name: 'mcp',
          root: './apps/mcp',
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
