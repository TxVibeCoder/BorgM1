/**
 * Stage geometry invariants. The design box is exactly 7:4 and the percentage
 * transform is lossless on whole percents; the insetRectilinear / polygonPath
 * cases are inherited from SynthStack (pure math, unchanged) and cover the border
 * inset the panel chrome will use in Phase 3.
 */

import { describe, expect, it } from 'vitest';
import {
  designToScreen,
  insetRectilinear,
  pctRect,
  polygonPath,
  STAGE,
  type Pt,
} from '../../src/ui/stage';

describe('stage design box', () => {
  it('is exactly 7:4', () => {
    expect(STAGE.w / STAGE.h).toBe(7 / 4);
  });

  it('maps 1% of the window onto whole pixels in both axes', () => {
    // The reason for 1400x800 over the 1200x683 reference frame: UI-SPEC gives
    // every figure as a percentage, so whole percents must not accumulate error.
    expect(STAGE.w / 100).toBe(14);
    expect(STAGE.h / 100).toBe(8);
    expect(Number.isInteger(STAGE.w / 100)).toBe(true);
    expect(Number.isInteger(STAGE.h / 100)).toBe(true);
  });

  it('designToScreen maps the unit square onto the stage corners', () => {
    expect(designToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(designToScreen(1, 1)).toEqual({ x: STAGE.w, y: STAGE.h });
    expect(designToScreen(0.5, 0.5)).toEqual({ x: 700, y: 400 });
  });

  it('pctRect converts a UI-SPEC percentage rectangle to stage px', () => {
    expect(pctRect(0, 0, 100, 100)).toEqual({ x: 0, y: 0, w: STAGE.w, h: STAGE.h });
    expect(pctRect(25, 50, 25, 25)).toEqual({ x: 350, y: 400, w: 350, h: 200 });
  });

  it('a full-width pctRect closes exactly on the stage edge (no seam gap)', () => {
    const left = pctRect(0, 0, 40, 100);
    const right = pctRect(40, 0, 60, 100);
    expect(left.x + left.w).toBe(right.x);
    expect(right.x + right.w).toBe(STAGE.w);
  });
});

describe('insetRectilinear', () => {
  it('insets a positive-area square toward its interior', () => {
    const square: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(insetRectilinear(square, 2)).toEqual([
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ]);
  });

  it('insets a reverse-winding square identically (orientation-independent)', () => {
    const square: Pt[] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ];
    expect(insetRectilinear(square, 2)).toEqual([
      [2, 2],
      [2, 8],
      [8, 8],
      [8, 2],
    ]);
  });

  it('handles a concave L-shape', () => {
    const ell: Pt[] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    expect(insetRectilinear(ell, 2)).toEqual([
      [2, 2],
      [18, 2],
      [18, 8],
      [8, 8],
      [8, 18],
      [2, 18],
    ]);
  });

  it('rejects non-axis-aligned and collinear-vertex polygons', () => {
    expect(() =>
      insetRectilinear(
        [
          [0, 0],
          [10, 5],
          [10, 10],
          [0, 10],
        ],
        2,
      ),
    ).toThrow(/not axis-aligned/);
    expect(() =>
      insetRectilinear(
        [
          [0, 0],
          [5, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        2,
      ),
    ).toThrow(/parallel edges/);
  });

  it('polygonPath emits a closed SVG path', () => {
    expect(
      polygonPath([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toBe('M 0.00 0.00 L 10.00 0.00 L 10.00 10.00 Z');
  });
});
