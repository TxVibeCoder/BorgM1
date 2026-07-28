/**
 * Smoke test against the DEPLOYED GitHub Pages build.
 *
 * WHY THIS IS SEPARATE FROM EVERY OTHER TEST HERE. Nothing else in the suite can see the
 * failure this exists to catch: `public/bank/` is gitignored, so a local checkout always has a
 * populated bank and `npm run dev` never exercises the missing-bank path. The first Pages
 * deploy rendered the entire panel perfectly and then failed on POWER with `BANK ERROR` — a
 * silent instrument that looked completely fine in a screenshot.
 *
 * So this asserts the two things only the real deployment can prove: the bank is actually
 * served alongside the app, and the engine reaches BANK OK and makes a sound.
 *
 *   npx playwright test test/e2e/deployedSite.spec.ts
 *
 * Skipped by default — it hits the network and depends on a deploy having landed. Run it with
 * BORGM1_DEPLOYED=1, or point it somewhere else with BORGM1_DEPLOYED=<url>.
 */

import { expect, test } from '@playwright/test';

const FLAG = process.env['BORGM1_DEPLOYED'];
const SITE =
  FLAG && FLAG !== '1' ? FLAG.replace(/\/$/, '') : 'https://txvibecoder.github.io/BorgM1';

test.describe('deployed site', () => {
  test.skip(!FLAG, 'set BORGM1_DEPLOYED=1 to run against the live Pages build');
  // The bank is 50 MiB over the public internet; the default 30 s is not enough.
  test.setTimeout(180_000);

  test('serves the app and its sample bank', async ({ request }) => {
    const page = await request.get(`${SITE}/`);
    expect(page.status(), 'index.html').toBe(200);
    expect(await page.text()).toContain('<title>BorgM1</title>');

    // THE ONE THAT MATTERS. A deploy without these is a silent instrument.
    const json = await request.get(`${SITE}/bank/bank.json`);
    expect(json.status(), 'bank/bank.json — the deploy did not build the bank').toBe(200);
    const manifest = JSON.parse(await json.text()) as {
      multisounds: unknown[];
      drums: unknown[];
    };
    expect(manifest.multisounds.length, 'multisounds in the manifest').toBe(100);
    expect(manifest.drums.length, 'drums in the manifest').toBe(44);

    const pcm = await request.head(`${SITE}/bank/bank.pcm`);
    expect(pcm.status(), 'bank/bank.pcm').toBe(200);
    const bytes = Number(pcm.headers()['content-length'] ?? 0);
    expect(bytes, 'bank.pcm looks truncated').toBeGreaterThan(40 * 1024 * 1024);
  });

  test('powers on, loads the bank and makes a sound', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    /**
     * TAP THE AUDIO GRAPH BEFORE THE APP EXISTS.
     *
     * `window.__borgm1` is stripped from production builds by the `import.meta.env.DEV`
     * guard, so a deployed page offers no handle to measure through. Wrapping
     * `AudioNode.prototype.connect` catches whatever the app connects to `destination` and
     * forks a copy into an analyser — which measures the real master output of a real
     * production build, with no dev-only surface involved.
     */
    await page.addInitScript(() => {
      const w = window as unknown as { __an?: AnalyserNode; __tapped?: boolean };
      const orig = AudioNode.prototype.connect;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AudioNode.prototype.connect = function (this: AudioNode, ...args: any[]): any {
        const result = orig.apply(this, args as never);
        try {
          if (!w.__tapped && args[0] === this.context.destination) {
            w.__tapped = true;
            const an = this.context.createAnalyser();
            an.fftSize = 8192;
            orig.call(this, an);
            w.__an = an;
          }
        } catch {
          /* a tap that fails must never break the page under test */
        }
        return result;
      };
    });

    await page.goto(`${SITE}/`);
    await page.getByRole('button', { name: /power on/i }).click();

    /**
     * `BANK OK` EXACTLY, from the header's own status text.
     *
     * NOT `getByTestId('bank-status')`, and not a `/BANK OK|MIDI/` alternation. That element
     * renders the MIDI status when one exists and only falls back to the bank status when it
     * does not — and headless Chrome reports "MIDI denied" instantly. The first version of
     * this test passed in 1.3 s against a 50 MiB download, because "MIDI denied" satisfied
     * the alternation while the bank was still in flight. It would have passed with no bank
     * deployed at all, which is the one thing it exists to catch.
     */
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll('svg text')).some(
              (t) => (t.textContent ?? '').trim() === 'BANK OK',
            ),
          ),
        { timeout: 150_000, message: 'header never reported BANK OK' },
      )
      .toBe(true);

    // Then MEASURE it rather than trusting the label — the rule the rest of the project
    // follows. A real pointer on the real keybed, and a peak off the tapped master output.
    const bed = page.getByTestId('keybed');
    await expect(bed).toBeVisible();
    const box = (await bed.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.7);
    await page.mouse.down();
    const peak = await page.evaluate(async () => {
      const w = window as unknown as { __an?: AnalyserNode };
      if (!w.__an) return -1;
      const buf = new Float32Array(w.__an.fftSize);
      let p = 0;
      // Sample repeatedly across the note: one grab can land in the attack.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 80));
        w.__an.getFloatTimeDomainData(buf);
        for (const v of buf) p = Math.max(p, Math.abs(v));
      }
      return p;
    });
    await page.mouse.up();

    expect(peak, 'the audio graph was never tapped').toBeGreaterThanOrEqual(0);
    expect(peak, 'pressed a key on the deployed build and heard silence').toBeGreaterThan(0.01);

    expect(errors.filter((e) => !/favicon/i.test(e)), errors.join('\n')).toEqual([]);
  });
});
