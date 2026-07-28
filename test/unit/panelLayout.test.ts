/**
 * Panel layout integrity.
 *
 * The load-bearing assertion is COVERAGE: every one of the 139 parameters must appear on
 * some page. Phase 3's done-criterion is that all of them are editable, and a parameter that
 * exists in the table, is wired to the engine, and is on no page is invisible — which is the
 * one failure mode that looks like success from every other angle. This test caught exactly
 * that during the build: the filter EG section was declared and never placed on a page.
 */

import { describe, expect, it } from 'vitest';
import { isOsc2Param, PROGRAM_PARAMS, programParam } from '../../data/programParams';
import {
  columnsFor,
  flowSections,
  PAGE_LAYOUTS,
  PAGES,
  paramIdFor,
  REGIONS,
  rowsFor,
  sectionHeight,
  type ParamSection,
} from '../../src/ui/panel/layout';
import { STAGE } from '../../src/ui/stage';

/** Every parameter id the panel renders, across all pages, both oscillators. */
function renderedIds(): Set<string> {
  const ids = new Set<string>();
  for (const page of PAGES) {
    const layout = PAGE_LAYOUTS[page];
    const sections: ParamSection[] = [...layout.left, ...layout.centre];
    for (const s of sections) {
      for (const p of s.params) {
        if (s.perOsc) {
          ids.add(paramIdFor(s, p, 1));
          ids.add(paramIdFor(s, p, 2));
        } else {
          ids.add(paramIdFor(s, p, 1));
        }
      }
    }
  }
  // The two EG graphs edit the filter and amp envelope bytes through their handles.
  for (const osc of [1, 2] as const) {
    for (const id of [
      'VDF_EG_AT', 'VDF_EG_AL', 'VDF_EG_DT', 'VDF_EG_BP',
      'VDF_EG_ST', 'VDF_EG_SL', 'VDF_EG_RT', 'VDF_EG_RL',
      'VDA_EG_AT', 'VDA_EG_AL', 'VDA_EG_DT', 'VDA_EG_BP',
      'VDA_EG_ST', 'VDA_EG_SL', 'VDA_EG_RT',
    ]) {
      ids.add(`OSC${osc}_${id}`);
    }
  }
  return ids;
}

describe('panel layout — coverage', () => {
  it('puts every program parameter somewhere a user can reach it', () => {
    const rendered = renderedIds();
    const missing = PROGRAM_PARAMS.filter((p) => !rendered.has(p.id)).map((p) => p.id);
    expect(missing, `parameters on no page: ${missing.join(', ')}`).toEqual([]);
  });

  it('references only real parameters', () => {
    // A typo in a section's list would silently render nothing; `programParam` throws.
    for (const page of PAGES) {
      const layout = PAGE_LAYOUTS[page];
      for (const s of [...layout.left, ...layout.centre]) {
        for (const p of s.params) {
          const oscs = s.perOsc ? ([1, 2] as const) : ([1] as const);
          for (const osc of oscs) {
            expect(() => programParam(paramIdFor(s, p, osc)), `${page}/${s.title}/${p}`).not.toThrow();
          }
        }
      }
    }
  });

  it('never lists an OSC1_/OSC2_ prefix inside a per-oscillator section', () => {
    // THE `1`/`2` RULE. A per-oscillator section declares the un-prefixed name once and is
    // instantiated twice; hard-coding a prefix would pin that entry to one oscillator and
    // is exactly how the two halves start to drift.
    for (const page of PAGES) {
      const layout = PAGE_LAYOUTS[page];
      for (const s of [...layout.left, ...layout.centre]) {
        if (!s.perOsc) continue;
        for (const p of s.params) {
          expect(p, `${page}/${s.title}`).not.toMatch(/^OSC[12]_/);
        }
      }
    }
  });

  it('greys out roughly a third of the panel in SINGLE mode', () => {
    // UI-SPEC §9 calls the disabled state a first-class visual and sizes it at about a third
    // of the centre column. If that fraction collapses, the disabled treatment has stopped
    // being designed and started being decorative.
    const osc2 = PROGRAM_PARAMS.filter(isOsc2Param).length;
    const fraction = osc2 / PROGRAM_PARAMS.length;
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.45);
  });
});

describe('panel layout — geometry', () => {
  it('keeps every region inside the 7:4 design box', () => {
    for (const [name, box] of Object.entries(REGIONS)) {
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.y, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w, name).toBeLessThanOrEqual(STAGE.w + 0.001);
      expect(box.y + box.h, name).toBeLessThanOrEqual(STAGE.h + 0.001);
    }
  });

  it('does not overlap the three work-area columns', () => {
    expect(REGIONS.left.x + REGIONS.left.w).toBeLessThanOrEqual(REGIONS.centre.x);
    expect(REGIONS.centre.x + REGIONS.centre.w).toBeLessThanOrEqual(REGIONS.right.x);
  });

  it('stacks the bands in UI-SPEC order without gaps or overlaps', () => {
    expect(REGIONS.header.y + REGIONS.header.h).toBeCloseTo(REGIONS.tabs.y, 6);
    expect(REGIONS.tabs.y + REGIONS.tabs.h).toBeLessThanOrEqual(REGIONS.left.y);
    expect(REGIONS.left.y + REGIONS.left.h).toBeLessThanOrEqual(REGIONS.keyboard.y);
    expect(REGIONS.keyboard.y + REGIONS.keyboard.h).toBeCloseTo(STAGE.h, 6);
  });

  it('flows every section inside its column, in order', () => {
    for (const page of PAGES) {
      const layout = PAGE_LAYOUTS[page];
      for (const [sections, region] of [
        [layout.left, REGIONS.left],
        [layout.centre, REGIONS.centre],
      ] as const) {
        const boxes = flowSections([...sections], region);
        expect(boxes).toHaveLength(sections.length);
        let prevBottom = region.y - 1;
        for (const b of boxes) {
          expect(b.x, page).toBe(region.x);
          expect(b.w, page).toBe(region.w);
          expect(b.y, page).toBeGreaterThan(prevBottom);
          prevBottom = b.y + b.h;
        }
        // Everything fits: the column never overflows its band.
        expect(prevBottom, `${page} column overflows`).toBeLessThanOrEqual(region.y + region.h + 0.001);
      }
    }
  });

  it('gives every section at least one column and one row', () => {
    for (const page of PAGES) {
      const layout = PAGE_LAYOUTS[page];
      for (const [sections, region] of [
        [layout.left, REGIONS.left],
        [layout.centre, REGIONS.centre],
      ] as const) {
        for (const s of sections) {
          const cols = columnsFor(region.w, s.columns);
          expect(cols, `${page}/${s.title}`).toBeGreaterThanOrEqual(1);
          expect(rowsFor(s.params.length, cols), `${page}/${s.title}`).toBeGreaterThanOrEqual(1);
          expect(sectionHeight(s, region.w), `${page}/${s.title}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('starts on EASY, the curated subset page', () => {
    // UI-SPEC §5: "the pattern that makes a 143-parameter instrument approachable, and the
    // most important thing to get right". So it is first in the list and is the default.
    expect(PAGES[0]).toBe('EASY');
  });
});
