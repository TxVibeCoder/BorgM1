/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * PORT 5184 is BorgM1's, portfolio-wide (5173 SynthStack, 5180 another local project,
 * 5182 another local project, 8737 another local project, 8765 another local project's Docker server). `strictPort`
 * makes a collision fail loudly instead of silently drifting to 5185 — a
 * drifted port is how you end up A/B-ing against a stale build.
 */
const PORT = 5184;

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/BorgM1/' : '/',
  plugins: [react()],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
}));
