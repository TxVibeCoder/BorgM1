/**
 * Stage geometry — the design-coordinate space, as code.
 *
 * Inherited mechanism from SynthStack's `stage16x9.ts` (the `designToScreen` /
 * `insetRectilinear` / `polygonPath` tail), with the 16:9 console constants
 * replaced by BorgM1's **7:4** design box. UI-SPEC.md §9.
 *
 * Coordinate frame: design px, y-down, origin = stage top-left. App.tsx scales
 * the whole stage uniformly to fit the window, so every panel's SVG viewBox maps
 * 1:1 to design px and no component ever does its own scaling.
 *
 * WHY 1400x800: UI-SPEC measures the reference plugin at 1.757:1 and gives every
 * figure as a percentage of the window, so the design box only has to be the right
 * SHAPE at a convenient scale. 1400x800 is exactly 7:4 (1200x683, the lossless
 * reference PNG, is 1.7569 — close, but not a ratio you want to carry in a
 * transform), and 1% of the window lands on a whole 14 x 8 px, so the spec's
 * percentages convert without accumulating rounding.
 *
 * REGIONS are deliberately absent: the panel layout arrives in Phase 3, authored
 * from UI-SPEC's percentage table via `pctRect` below. Nothing here presumes it.
 */

/** The design box. Exactly 7:4. */
export const STAGE = { w: 1400, h: 800 } as const;

export interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Convert one design-space point, expressed as FRACTIONS of the window (the form
 * every figure in UI-SPEC.md takes), to stage px. `designToScreen(0.5, 0.5)` is the
 * stage centre.
 */
export function designToScreen(fx: number, fy: number): { x: number; y: number } {
  return { x: fx * STAGE.w, y: fy * STAGE.h };
}

/**
 * Build a stage-px rectangle from a UI-SPEC percentage rectangle. Percentages,
 * not fractions, because that is literally how the spec is written — transcribing
 * `left 4.5%, top 12%, width 31%, height 26%` should be a copy, not a conversion.
 */
export function pctRect(leftPct: number, topPct: number, widthPct: number, heightPct: number): RegionBox {
  return {
    x: (leftPct / 100) * STAGE.w,
    y: (topPct / 100) * STAGE.h,
    w: (widthPct / 100) * STAGE.w,
    h: (heightPct / 100) * STAGE.h,
  };
}

export type Pt = readonly [number, number];

/** Signed area (shoelace); > 0 = counter-clockwise in y-down screen space. */
function signedArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Inset a closed RECTILINEAR polygon by `d` toward its interior. Adjacent section
 * borders share seam lines; drawing both centered on the seam would overpaint, so
 * each outline pulls in by half the stroke plus a hair before stroking.
 *
 * Every edge must be axis-aligned. Each edge offsets toward the interior side; new
 * vertices are the re-intersections of consecutive offset edges (trivial for
 * axis-aligned edges: x comes from the vertical edge, y from the horizontal one).
 */
export function insetRectilinear(points: readonly Pt[], d: number): Pt[] {
  const n = points.length;
  // In y-down screen space a CLOCKWISE polygon has negative shoelace area and
  // its interior lies to the LEFT of travel… orientation conventions invert
  // with the y-flip, so derive the interior side from the sign directly.
  const ccw = signedArea(points) > 0;

  interface Edge {
    vertical: boolean;
    /** Offset line position: x for vertical edges, y for horizontal. */
    pos: number;
  }

  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % n]!;
    if (x1 === x2 && y1 === y2) throw new Error(`degenerate edge at vertex ${i}`);
    if (x1 !== x2 && y1 !== y2) {
      throw new Error(`edge ${i} is not axis-aligned: (${x1},${y1})→(${x2},${y2})`);
    }
    // Positive shoelace area in y-down coords ⇒ interior lies to the RIGHT of
    // travel ("right" = travel direction rotated 90° screen-clockwise).
    const interiorRight = ccw;
    if (x1 === x2) {
      const down = y2 > y1; // right of downward travel is −x
      const sign = (down ? 1 : -1) * (interiorRight ? -1 : 1);
      edges.push({ vertical: true, pos: x1 + sign * d });
    } else {
      const right = x2 > x1; // right of rightward travel is +y
      const sign = (right ? -1 : 1) * (interiorRight ? -1 : 1);
      edges.push({ vertical: false, pos: y1 + sign * d });
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n]!;
    const cur = edges[i]!;
    if (prev.vertical === cur.vertical) {
      throw new Error(`consecutive parallel edges at vertex ${i} (collinear point?)`);
    }
    const x = prev.vertical ? prev.pos : cur.pos;
    const y = prev.vertical ? cur.pos : prev.pos;
    out.push([x, y]);
  }
  return out;
}

/** SVG path ("M … Z") for a closed polygon. */
export function polygonPath(points: readonly Pt[]): string {
  return (
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') +
    ' Z'
  );
}
