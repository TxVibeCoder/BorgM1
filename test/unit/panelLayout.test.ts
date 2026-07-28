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
import {
  COMBI_CONTROL_DEFS,
  COMBI_PARAMS,
  combiParam,
  TIMBRE_COUNT,
} from '../../data/combiParams';
import { EFFECT_ALGORITHMS, effectAlgorithm, toEffectControlDef } from '../../data/effectParams';
import { isOsc2Param, PROGRAM_PARAMS, programParam } from '../../data/programParams';
import { validateControlDefs, type ControlDef } from '../../data/schema';
import {
  CELL,
  cellAt,
  columnsFor,
  COMBI_PAGES,
  COMBI_PAGE_LAYOUTS,
  COMBI_PAGE_SECTIONS,
  flowSections,
  PAGE_LAYOUTS,
  PAGES,
  PARAM_PAGES,
  paramIdFor,
  REGIONS,
  rowsFor,
  sectionHeight,
  TIMBRE_ROW,
  TIMBRE_ROW_W,
  type ParamSection,
} from '../../src/ui/panel/layout';
import { STAGE } from '../../src/ui/stage';

/** Every parameter id the panel renders, across all pages, both oscillators. */
function renderedIds(): Set<string> {
  const ids = new Set<string>();
  for (const page of PARAM_PAGES) {
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
    for (const page of PARAM_PAGES) {
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
    for (const page of PARAM_PAGES) {
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

/**
 * The FX page's counterpart to the coverage test above.
 *
 * An effect slot's parameter list is DYNAMIC — it comes from whichever of the 33 algorithms
 * is loaded — so "is it on a page?" has to be asked differently: every algorithm must FIT in
 * the box, and every parameter must project onto a control the panel can actually render.
 * The failure being guarded against is the same one the program-parameter test caught in
 * Phase 3: a parameter that exists, reaches the engine, and is unreachable from the panel.
 */
describe('panel layout — the FX page', () => {
  /** The slot box App.tsx builds: the left column, halved. */
  const fxBox = { ...REGIONS.left, h: (REGIONS.left.h - 12) / 2 };
  /** Title bar plus the algorithm selector strip, both sitting above the parameter grid. */
  const HEADROOM = 60;

  it('is a page you can navigate to, and is not a parameter page', () => {
    expect(PAGES).toContain('FX');
    expect(PARAM_PAGES).not.toContain('FX');
  });

  it('fits every algorithm inside a slot box, its two balance knobs included', () => {
    const cols = columnsFor(fxBox.w);
    for (const algo of EFFECT_ALGORITHMS) {
      // +2 for the two Dry:EFF knobs, which are SLOT parameters rather than algorithm
      // parameters but still have to be placed.
      const cells = algo.params.length + 2;
      const needed = HEADROOM + rowsFor(cells, cols) * CELL.h;
      expect(
        needed,
        `#${algo.index} ${algo.name} needs ${needed}px of ${fxBox.h.toFixed(0)}`,
      ).toBeLessThanOrEqual(fxBox.h);
      const last = cellAt(cells - 1, cols, fxBox.x, fxBox.y + HEADROOM);
      expect(last.x + CELL.w / 2, `#${algo.index} ${algo.name} overflows to the right`).toBeLessThanOrEqual(
        fxBox.x + fxBox.w + 0.001,
      );
    }
  });

  it('projects every effect parameter onto a control the panel can render', () => {
    // The same validator data/schema.ts runs over the program parameters. A knob with no
    // range, or a switch with one position, renders as a DEAD control rather than an error —
    // so it is caught here instead of in the browser.
    for (const algo of EFFECT_ALGORITHMS) {
      const defs: ControlDef[] = algo.params.map((p) => ({
        ...(toEffectControlDef(p) as ControlDef),
        // Ids are unique within an algorithm, not globally; qualify them so the duplicate
        // check is asking a fair question.
        id: `FX_${algo.index}_${p.id}`,
      }));
      const errors = validateControlDefs(`effect ${algo.index} ${algo.name}`, defs);
      expect(errors, errors.join('\n')).toEqual([]);
    }
  });

  it('gives every algorithm at least one editable parameter', () => {
    // An algorithm that reached the catalogue with an empty list would render an empty box
    // and look deliberate.
    for (const algo of EFFECT_ALGORITHMS) {
      expect(algo.params.length, `#${algo.index} ${algo.name}`).toBeGreaterThan(0);
    }
  });

  it('keeps every algorithm name short enough for the selector\'s LCD field', () => {
    for (let t = 0; t <= EFFECT_ALGORITHMS.length; t++) {
      const name = t === 0 ? 'NO EFFECT' : effectAlgorithm(t)!.name;
      expect(name.length, `type ${t}`).toBeGreaterThan(0);
      expect(name.length, `type ${t} name "${name}" overflows the field`).toBeLessThanOrEqual(16);
    }
  });
});

/**
 * The Combination panel's counterpart to the coverage test above, and the same failure is
 * being guarded against: a parameter that exists in the 124-byte record, reaches the engine,
 * and is on no page. The strip covers four fields per row; the centre and right columns cover
 * the rest, and between them they have to cover all of it.
 */
describe('panel layout — the Combination pages', () => {
  /** Fields the 8-row strip renders directly, per UI-SPEC §3. */
  const STRIP_FIELDS = ['PROGRAM', 'LEVEL', 'PAN', 'TIMBRE_OFF'];
  /**
   * Fields with no control anywhere, each for a stated reason. Kept short and explicit — a
   * long list is how "every parameter is editable" quietly stops being true.
   */
  const NOT_EDITABLE: Record<string, string> = {
    PAN_SOURCE: 'an honest unknown the factory bank refutes; carried verbatim, not modelled',
    FILTER_RESERVED: 'undocumented bits, carried verbatim so an import is lossless',
  };

  function renderedCombiFields(): Set<string> {
    const ids = new Set<string>(STRIP_FIELDS);
    for (const s of COMBI_PAGE_SECTIONS) for (const p of s.params) ids.add(p);
    return ids;
  }

  it('puts every combination parameter somewhere a user can reach it', () => {
    const rendered = renderedCombiFields();
    const missing = COMBI_PARAMS.filter((p) => {
      const field = p.id.replace(/^T\d_/, '');
      return !rendered.has(field) && !(field in NOT_EDITABLE);
    }).map((p) => p.id);
    expect(missing, `parameters on no page: ${missing.join(', ')}`).toEqual([]);
  });

  it('references only real parameters', () => {
    for (const s of COMBI_PAGE_SECTIONS) {
      for (const p of s.params) {
        const id = s.global ? p : `T1_${p}`;
        expect(() => combiParam(id), `${s.title}/${p}`).not.toThrow();
      }
    }
  });

  it('never hard-codes a timbre prefix inside a per-timbre section', () => {
    // The Combination twin of the `1`/`2` rule: a section declares the un-prefixed field once
    // and binds it to whichever row the strip has selected.
    for (const s of COMBI_PAGE_SECTIONS) {
      if (s.global) continue;
      for (const p of s.params) expect(p, s.title).not.toMatch(/^T\d_/);
    }
  });

  it('projects every combination parameter onto a control the panel can render', () => {
    const errors = validateControlDefs('combi', COMBI_CONTROL_DEFS);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  /**
   * EIGHT ROWS OF SIX CONTROLS IS THE DENSEST SURFACE IN THE INSTRUMENT, and the row's pieces
   * are hand-placed rather than flowed — so this is the one place a hard-coded coordinate can
   * still put a control off the end of its row. The rendered-page audit checks the same thing
   * in pixels; this catches it before the browser is even opened.
   */
  it('fits one timbre row inside the strip, with every piece in order', () => {
    const R = TIMBRE_ROW;
    // The strip pads its rows by 6px on each side.
    const rowW = REGIONS.left.w - 12;
    expect(TIMBRE_ROW_W, `row needs ${TIMBRE_ROW_W}px of ${rowW}`).toBeLessThanOrEqual(rowW);

    const pieces: [string, number, number][] = [
      ['buttons', R.buttonsX, 4 * R.buttonW + 3 * R.buttonGap],
      ['name', R.nameX, R.nameW],
      ['level', R.levelX, R.levelW],
      ['pan', R.panX, R.panW],
      ['out', R.outX, R.outW],
    ];
    let prevRight = R.numX;
    for (const [name, x, w] of pieces) {
      expect(x, `${name} overlaps what precedes it`).toBeGreaterThanOrEqual(prevRight);
      prevRight = x + w;
    }
    expect(prevRight).toBeLessThanOrEqual(rowW);
  });

  it('stacks all eight rows inside the left column', () => {
    const needed = 12 + TIMBRE_COUNT * (TIMBRE_ROW.h + TIMBRE_ROW.gap) - TIMBRE_ROW.gap;
    expect(needed, `${TIMBRE_COUNT} rows need ${needed}px of ${REGIONS.left.h}`).toBeLessThanOrEqual(
      REGIONS.left.h,
    );
  });

  it('flows the Combination sections inside their columns', () => {
    for (const layout of Object.values(COMBI_PAGE_LAYOUTS)) {
      for (const [sections, region] of [
        [layout.centre, REGIONS.centre],
        [layout.right, REGIONS.right],
      ] as const) {
        // The derived SPLIT / VELOCITY SWITCH point adds one cell to whichever section hosts
        // it, so the flow has to fit with it present as well as absent.
        const withExtra = sections.map((s) => ({
          title: s.title,
          params: s.hostsDerivedPoint ? [...s.params, 'DERIVED'] : s.params,
          columns: s.columns,
        }));
        const boxes = flowSections(withExtra, region);
        let prevBottom = region.y - 1;
        for (const b of boxes) {
          expect(b.y, layout.centre[0]?.title).toBeGreaterThan(prevBottom);
          prevBottom = b.y + b.h;
        }
        expect(prevBottom).toBeLessThanOrEqual(region.y + region.h + 0.001);
      }
    }
  });

  it('has a TIMBRE page and an FX page, and nothing else', () => {
    expect([...COMBI_PAGES]).toEqual(['TIMBRE', 'FX']);
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
    for (const page of PARAM_PAGES) {
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
    for (const page of PARAM_PAGES) {
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
