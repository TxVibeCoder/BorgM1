/**
 * Playwright config.
 *
 * CONSTRAINT: nothing is installed outside this repo — never run
 * `npx playwright install` and never download a browser. `channel: 'chrome'`
 * drives the already-installed Chrome; if Chrome ever fails to
 * launch, switch the channel to 'msedge' (the supported fallback) — both are
 * system browsers, not Playwright-managed downloads.
 *
 * No specs yet. Phase 2 adds the offline audio battery here: a dev-harness
 * route renders its results as a JSON blob on the page and a ~10-line spec
 * reads it back — the pattern that sidesteps Node's lack of AudioWorklet.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  use: {
    channel: 'chrome',
    headless: true,
    /** webServer.port below — page.goto('/') resolves against this. */
    baseURL: 'http://localhost:5184',
  },
  webServer: {
    command: 'npm run dev',
    port: 5184,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
