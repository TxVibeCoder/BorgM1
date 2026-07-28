/**
 * THE RENDERED-PAGE AUDIT. Walks every `<text>` pair at a real window size and fails any
 * overlap between different controls.
 *
 * WHY THIS EXISTS RATHER THAN A UNIT TEST. `panelLayout.test.ts` asserts that every parameter
 * is on some page and that every column fits its band, and it was GREEN while text printed
 * over text in six places — the first human look at the app found them. Unit tests reason
 * about boxes the layout declares; only measuring the rendered page sees glyphs. The audit
 * went dozens -> 4 -> 2 -> 0 after Phase 4, and each intermediate count was a distinct bug
 * class.
 *
 * PHASE 5 REBUILDS IT FOR THE TIMBRE STRIP, which is the densest surface in the instrument:
 * eight rows of six controls in the space three parameter sections used to occupy. The
 * handoff called this "exactly the density that breaks this way", and it was right — see the
 * clearances in `TIMBRE_ROW`.
 *
 *   npx playwright test test/e2e/layoutAudit.spec.ts
 */

import { expect, test, type Page } from '@playwright/test';

/** A real window, not the design box. The bug class only appears once the stage is scaled. */
const VIEWPORT = { width: 1900, height: 1030 };

/** Overlaps below this are antialiasing and letter-spacing slop, not collisions. */
const MAX_OVERLAP_AREA = 8;

interface TextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Identity of the nearest control-ish ancestor, so a label over its own value is fine. */
  owner: string;
}

async function collectText(page: Page): Promise<TextBox[]> {
  return page.evaluate(() => {
    const out: TextBox[] = [];
    for (const el of Array.from(document.querySelectorAll('svg text'))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // Invisible text still occupies no visual space; a disabled control's is dimmed but
      // present, and it must still not collide.
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) === 0) continue;
      // Nearest ancestor that reads as one control: an aria-labelled node, or the <g> the
      // control component wraps its parts in.
      let owner = '';
      let node: Element | null = el;
      let depth = 0;
      while (node && depth < 4) {
        const label = node.getAttribute('aria-label') ?? node.getAttribute('role');
        if (label) {
          owner = `${label}@${Math.round(node.getBoundingClientRect().x)},${Math.round(node.getBoundingClientRect().y)}`;
          break;
        }
        node = node.parentElement;
        depth++;
      }
      if (!owner) {
        const p = el.parentElement;
        const pr = p?.getBoundingClientRect();
        owner = pr ? `g@${Math.round(pr.x)},${Math.round(pr.y)},${Math.round(pr.width)}` : 'none';
      }
      out.push({
        text: (el.textContent ?? '').trim(),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        owner,
      });
    }
    return out;
  });
}

function overlapArea(a: TextBox, b: TextBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Every LABELLED CONTROL's own bounding box.
 *
 * The text-versus-text check above is blind to a control's non-text parts, and that blindness
 * shipped a real bug this phase: the derived SPLIT knob was placed one 64 px cell from the
 * five-position TYPE switch, whose `VELOCITY SWITCH` label runs 90 px wide — so the knob's
 * gold circle sat on top of the switch's position list. No two <text> boxes overlapped, so the
 * audit passed and the screenshot did not. Comparing whole controls catches the general form.
 */
async function collectControls(page: Page): Promise<TextBox[]> {
  return page.evaluate(() => {
    const out: TextBox[] = [];
    for (const el of Array.from(document.querySelectorAll('svg [aria-label]'))) {
      // Only leaf-ish controls: a group that CONTAINS another labelled node is a container,
      // and containers legitimately enclose their children.
      if (el.querySelector('[aria-label]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      out.push({
        text: el.getAttribute('aria-label') ?? '',
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        owner: el.getAttribute('aria-label') ?? '',
      });
    }
    return out;
  });
}

/** True when `outer` fully encloses `inner`. */
function contains(outer: TextBox, inner: TextBox): boolean {
  return (
    outer.x <= inner.x + 0.5 &&
    outer.y <= inner.y + 0.5 &&
    outer.x + outer.w >= inner.x + inner.w - 0.5 &&
    outer.y + outer.h >= inner.y + inner.h - 0.5
  );
}

/**
 * Controls may ABUT — a 64 px cell grid puts neighbours edge to edge, and a knob's label makes
 * its box slightly wider than its cell. They may also NEST: each timbre row's background is
 * itself a labelled control that legitimately encloses the six inside it, which the separate
 * "inside its own row" test is the right place to check.
 *
 * What must not happen is one control sitting PARTLY on another, so the rule is: ignore
 * containment, and fail any partial overlap past a quarter of the smaller box.
 */
function controlCollisions(boxes: TextBox[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.owner === b.owner) continue;
      if (contains(a, b) || contains(b, a)) continue;
      const area = overlapArea(a, b);
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (area > smaller * 0.25) {
        bad.push(
          `"${a.text}" over "${b.text}" — ${Math.round(area)}px², ` +
            `${Math.round((100 * area) / smaller)}% of the smaller`,
        );
      }
    }
  }
  return bad;
}

function collisions(boxes: TextBox[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      // Two glyphs of ONE control may share space (a value centred on its own housing).
      if (a.owner === b.owner) continue;
      const area = overlapArea(a, b);
      if (area > MAX_OVERLAP_AREA) {
        bad.push(
          `"${a.text}" (${a.owner}) over "${b.text}" (${b.owner}) — ${Math.round(area)}px²`,
        );
      }
    }
  }
  return bad;
}

async function powerOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: /power on/i }).click();
  // The bank load is what fills the multisound name fields; without it the widest strings
  // never render and the audit measures a narrower page than the user sees.
  await expect(page.getByTestId('bank-status')).toContainText(/BANK OK|MIDI/, { timeout: 60_000 });
}

test.describe('rendered-page layout audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    await powerOn(page);
  });

  test('no text collides on any program page', async ({ page }) => {
    for (const tab of ['EASY', 'OSC', 'FILTER', 'AMP', 'CONTROL', 'FX']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(80);
      const bad = collisions(await collectText(page));
      expect(bad, `${tab}:\n${bad.join('\n')}`).toEqual([]);
      const ctrl = controlCollisions(await collectControls(page));
      expect(ctrl, `${tab} controls:\n${ctrl.join('\n')}`).toEqual([]);
    }
  });

  /**
   * THE ONE THIS PHASE ADDED. Every combination type, because the type decides how many rows
   * are live and whether the derived split/velocity control is present — and a control that
   * only appears for one type is exactly the one nobody looks at.
   */
  test('no text collides on the timbre strip, for any combination type', async ({ page }) => {
    await page.getByRole('radio', { name: /COMBI mode/i }).click();
    await page.waitForTimeout(120);

    for (const type of ['SINGLE', 'LAYER', 'SPLIT', 'VELOCITY SWITCH', 'MULTI']) {
      await page.evaluate((t) => {
        (window as unknown as { __borgm1: { setCombiType(t: string): void } }).__borgm1.setCombiType(t);
      }, type);
      await page.waitForTimeout(80);

      // Select each row in turn: the centre and right columns bind to the selected timbre,
      // and row 8's label is a different width from row 1's.
      //
      // Clicked in the ROW NUMBER GUTTER, not at the row's centre — the centre is covered by
      // the program stepper, which is correct (the strip is dense on purpose) and which the
      // row handles by selecting on pointer-down capture from any of its controls.
      for (const row of [0, 3, 7]) {
        await page
          .getByRole('button', { name: `Select timbre ${row + 1}` })
          .click({ position: { x: 8, y: 20 } });
        await page.waitForTimeout(50);
        const bad = collisions(await collectText(page));
        expect(bad, `${type} / timbre ${row + 1}:\n${bad.join('\n')}`).toEqual([]);
        const ctrl = controlCollisions(await collectControls(page));
        expect(ctrl, `${type} / timbre ${row + 1} controls:\n${ctrl.join('\n')}`).toEqual([]);
      }
    }
  });

  /**
   * The strip's rows must stay inside their own band. A row that overflows is the same bug
   * class as the keybed that grew three times its height: it is invisible at the aspect ratio
   * you happen to develop at, and obvious at any other.
   */
  test('every timbre row fits inside the strip', async ({ page }) => {
    await page.getByRole('radio', { name: /COMBI mode/i }).click();
    await page.waitForTimeout(120);

    const strip = await page.getByRole('group', { name: 'Combination timbres' }).boundingBox();
    expect(strip).not.toBeNull();

    for (let i = 0; i < 8; i++) {
      const row = await page.getByRole('button', { name: `Select timbre ${i + 1}` }).boundingBox();
      expect(row, `timbre ${i + 1} has no box`).not.toBeNull();
      expect(row!.x).toBeGreaterThanOrEqual(strip!.x - 1);
      expect(row!.x + row!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
      expect(row!.y).toBeGreaterThanOrEqual(strip!.y - 1);
      expect(row!.y + row!.height).toBeLessThanOrEqual(strip!.y + strip!.height + 1);
    }
  });

  /**
   * Every control the strip declares has to actually be reachable. A control that is laid out
   * off the end of its row still passes an overlap test — it simply never collides with
   * anything, because nothing else is out there either.
   */
  test('every strip control is inside its own row', async ({ page }) => {
    await page.getByRole('radio', { name: /COMBI mode/i }).click();
    await page.evaluate(() => {
      (window as unknown as { __borgm1: { setCombiType(t: string): void } }).__borgm1.setCombiType('MULTI');
    });
    await page.waitForTimeout(120);

    for (let i = 1; i <= 8; i++) {
      const row = await page.getByRole('button', { name: `Select timbre ${i}` }).boundingBox();
      for (const name of [
        `Solo timbre ${i}`,
        `Mute timbre ${i} (TIMBRE ON/OFF)`,
        `Timbre ${i} level`,
        `Timbre ${i} pan`,
        `Timbre ${i} output bus`,
        `Timbre ${i} program up`,
      ]) {
        const box = await page.getByRole(/level|pan/.test(name) ? 'slider' : 'switch', { name })
          .or(page.getByRole('button', { name }))
          .first()
          .boundingBox();
        expect(box, `${name} not rendered`).not.toBeNull();
        expect(box!.x, name).toBeGreaterThanOrEqual(row!.x - 1);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(row!.x + row!.width + 1);
        expect(box!.y, name).toBeGreaterThanOrEqual(row!.y - 1);
        expect(box!.y + box!.height, name).toBeLessThanOrEqual(row!.y + row!.height + 1);
      }
    }
  });
});
