/**
 * The two envelope graphs.
 *
 * TWO COMPONENTS, NOT ONE — and not one component with a flag, which is the same mistake
 * wearing a disguise. UI-SPEC §3 and CLAUDE.md both call this out, and the reason is that
 * the asymmetry is ENGINE BEHAVIOUR showing through rather than a drawing detail:
 *
 *   FILTER EG  8 parameters, levels SIGNED (-99..99) around the cutoff, and it releases to
 *              a LEVEL — so its trace lives around a centre line and steps to wherever
 *              RELEASE LEVEL puts it.
 *   AMP EG     7 parameters, levels UNSIGNED (0..99), and it has NO release level — so its
 *              trace lives above a floor and always falls to that floor.
 *
 * That missing eighth parameter is the whole difference, and it is visible here as the fact
 * that `AmpEgGraph` has no release-level handle to draw. Merging them would require
 * inventing a release level for the amp EG, which is exactly the bug the split prevents: an
 * amplifier that released to a non-zero level would never stop sounding.
 *
 * Handles are draggable: horizontal sets the segment's TIME, vertical its LEVEL, both
 * through the same store/engine contract as a knob (drag previews, release commits).
 */

import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { egTimeToSeconds } from '../../engine/dsp/levelTimeEgCore';
import { engineBridge } from '../../engine/engineBridge';
import type { RegionBox } from '../stage';
import { COLORS, FONT_CONDENSED } from '../theme';
import { useControl } from '../useControl';

/** One breakpoint on the trace. `level` is absent for a time-only segment (release of AMP). */
interface Breakpoint {
  label: string;
  timeId: string;
  levelId?: string;
}

// t is sized for TWO text rows above the well — the frame title, then the segment headers.
// They used to share one row and the first header printed across the title ("FILTER EG 1"
// with ATTACK on top of it); the well gives up 16px instead.
const PAD = { l: 16, r: 12, t: 38, b: 16 };
const HANDLE = 7;

/** Pixels of vertical drag for the full level range. Matches the knob's feel. */
const LEVEL_DRAG_PX = 160;
/** Pixels of horizontal drag for the full 0..99 time range. */
const TIME_DRAG_PX = 200;

/**
 * One numeric parameter.
 *
 * Called an explicit, fixed number of times in each graph rather than inside a `.map` over
 * the breakpoint list. The list is fixed-length so a loop would happen to work, but the
 * hook order would then depend on the contents of a data structure — and the day someone
 * adds a fifth breakpoint it breaks in a way that points at React rather than at the edit.
 */
function useParamNum(id: string): number {
  const v = useControl(id);
  return typeof v === 'number' ? v : 0;
}

/**
 * A draggable square handle. Horizontal drag scrubs `timeId`, vertical scrubs `levelId`.
 *
 * The value is read from the store on every render rather than held locally, so a knob and
 * the graph stay in agreement no matter which one you touch.
 */
function Handle({
  x,
  y,
  label,
  timeId,
  levelId,
  time,
  level,
  levelMin,
  levelMax,
  enabled,
  wellTop,
}: {
  x: number;
  y: number;
  label: string;
  timeId: string;
  levelId?: string;
  /** Current values, read by the graph — this component subscribes to nothing. */
  time: number;
  level: number;
  levelMin: number;
  levelMax: number;
  enabled: boolean;
  /** Top edge of the graph well, so the letter can dodge below a top-parked handle. */
  wellTop: number;
}) {
  const start = useRef({ px: 0, py: 0, time: 0, level: 0 });

  const onDown = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!enabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, time, level };
    },
    [enabled, time, level],
  );

  const scrub = useCallback(
    (e: ReactPointerEvent<SVGRectElement>, commit: boolean) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const s = start.current;
      const dt = ((e.clientX - s.px) / TIME_DRAG_PX) * 99;
      const nextTime = Math.round(Math.min(99, Math.max(0, s.time + dt)));
      const write = commit ? engineBridge.setParam : engineBridge.previewParam;
      write.call(engineBridge, timeId, nextTime);
      if (levelId) {
        // Up is more, matching the knob convention — screen y grows downward, hence the sign.
        const dl = ((s.py - e.clientY) / LEVEL_DRAG_PX) * (levelMax - levelMin);
        const nextLevel = Math.round(Math.min(levelMax, Math.max(levelMin, s.level + dl)));
        write.call(engineBridge, levelId, nextLevel);
      }
    },
    [timeId, levelId, levelMin, levelMax],
  );

  return (
    <g opacity={enabled ? 1 : 0.35}>
      <rect
        x={x - HANDLE / 2}
        y={y - HANDLE / 2}
        width={HANDLE}
        height={HANDLE}
        fill={COLORS.metal}
        stroke={COLORS.panelShadow}
        strokeWidth={0.75}
        style={{ cursor: enabled ? 'move' : 'default', pointerEvents: enabled ? 'auto' : 'none' }}
        onPointerDown={onDown}
        onPointerMove={(e) => scrub(e, false)}
        onPointerUp={(e) => scrub(e, true)}
        onPointerCancel={(e) => scrub(e, true)}
      />
      {/* The letter flips BELOW the handle near the top of the well: a handle at a level
          of 99 sits on the well's top edge, and a letter above it would print into the
          segment-header row (INIT PROG parks three amp-EG handles exactly there). */}
      <text
        x={x}
        y={y - wellTop < 14 ? y + HANDLE + 8 : y - HANDLE}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={9}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Shared plotting: turn a list of breakpoints into x positions by their TIMES.
 *
 * Times are converted through the engine's own `egTimeToSeconds` rather than plotted
 * linearly from the 0..99 parameter, so the trace shows the shape you will actually hear.
 * The curve is exponential, so a linear plot would make every fast envelope look identical.
 */
function xPositions(times: number[], box: RegionBox): number[] {
  const seconds = times.map(egTimeToSeconds);
  const total = seconds.reduce((a, b) => a + b, 0);
  const w = box.w - PAD.l - PAD.r;
  const out: number[] = [box.x + PAD.l];
  let acc = 0;
  for (const s of seconds) {
    acc += s;
    // A degenerate all-zero envelope still needs distinct x positions, or every handle
    // stacks on one pixel and none of them can be grabbed.
    out.push(box.x + PAD.l + (total > 0 ? (acc / total) * w : (out.length / seconds.length) * w));
  }
  // A PARTIALLY zero envelope stacks handles too — INIT PROG's amp EG has zero attack,
  // decay and slope, which put A, D and S on the same pixel (their letters printed over
  // each other, and only the topmost was grabbable). Enforce a minimum spacing forward,
  // then walk BACK from the right edge so the spread cannot push the last handle out of
  // the well. Purely a display/hit-target adjustment — the times themselves are untouched.
  const MIN_GAP = 16;
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + MIN_GAP);
  const right = box.x + PAD.l + w;
  out[out.length - 1] = Math.min(out[out.length - 1]!, right);
  for (let i = out.length - 2; i >= 1; i--) out[i] = Math.min(out[i]!, out[i + 1]! - MIN_GAP);
  return out;
}

function GraphFrame({ box, title, children }: { box: RegionBox; title: string; children: React.ReactNode }) {
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={6}
        fill={COLORS.panel}
        stroke={COLORS.panelEdge}
        strokeWidth={2}
      />
      {/* The graph well. UI-SPEC §7 measures these as a vertical gradient into near-black. */}
      <rect
        x={box.x + PAD.l - 6}
        y={box.y + PAD.t - 8}
        width={box.w - PAD.l - PAD.r + 12}
        height={box.h - PAD.t - PAD.b + 12}
        rx={3}
        fill={COLORS.panelShadow}
      />
      <text
        x={box.x + 10}
        y={box.y + 14}
        fill={COLORS.legend}
        fontFamily={FONT_CONDENSED}
        fontSize={12}
        letterSpacing={1.5}
      >
        {title}
      </text>
      {children}
    </g>
  );
}

function segmentHeaders(box: RegionBox, labels: string[]) {
  const w = box.w - PAD.l - PAD.r;
  return labels.map((label, i) => (
    <text
      key={label}
      x={box.x + PAD.l + ((i + 0.5) / labels.length) * w}
      // The second text row: fully below the title's descent, just above the well's top edge.
      y={box.y + PAD.t - 12}
      fill={COLORS.legendDim}
      fontFamily={FONT_CONDENSED}
      fontSize={8}
      letterSpacing={0.8}
      textAnchor="middle"
      opacity={0.8}
    >
      {label}
    </text>
  ));
}

export interface EgGraphProps {
  box: RegionBox;
  /** 1 or 2 — which oscillator's envelope this draws. */
  osc: 1 | 2;
  enabled: boolean;
}

/**
 * FILTER EG. Levels are SIGNED, so the trace is drawn around a centre line, and the release
 * segment ends at RELEASE LEVEL rather than at the floor.
 */
export function FilterEgGraph({ box, osc, enabled }: EgGraphProps) {
  const p = (id: string) => `OSC${osc}_${id}`;
  const points: Breakpoint[] = [
    { label: 'A', timeId: p('VDF_EG_AT'), levelId: p('VDF_EG_AL') },
    { label: 'D', timeId: p('VDF_EG_DT'), levelId: p('VDF_EG_BP') },
    { label: 'S', timeId: p('VDF_EG_ST'), levelId: p('VDF_EG_SL') },
    { label: 'R', timeId: p('VDF_EG_RT'), levelId: p('VDF_EG_RL') },
  ];

  const times = [
    useParamNum(p('VDF_EG_AT')),
    useParamNum(p('VDF_EG_DT')),
    useParamNum(p('VDF_EG_ST')),
    useParamNum(p('VDF_EG_RT')),
  ];
  const levels = [
    useParamNum(p('VDF_EG_AL')),
    useParamNum(p('VDF_EG_BP')),
    useParamNum(p('VDF_EG_SL')),
    useParamNum(p('VDF_EG_RL')),
  ];
  const xs = xPositions(times, box);

  const top = box.y + PAD.t;
  const height = box.h - PAD.t - PAD.b;
  const mid = top + height / 2;
  // -99..99 across the full height, so the centre line is level 0 — the cutoff itself.
  const yOf = (level: number) => mid - (level / 99) * (height / 2);

  const path = [`M ${xs[0]} ${mid}`, ...levels.map((l, i) => `L ${xs[i + 1]} ${yOf(l)}`)].join(' ');

  return (
    <GraphFrame box={box} title={`FILTER EG ${osc}`}>
      {segmentHeaders(box, ['ATTACK', 'DECAY', 'SLOPE', 'RELEASE'])}
      {/* The zero line. On the filter EG this is a real, meaningful value — the unmodulated
          cutoff — which is exactly what the amp EG has no equivalent of. */}
      <line
        x1={box.x + PAD.l}
        y1={mid}
        x2={box.x + box.w - PAD.r}
        y2={mid}
        stroke={COLORS.panelEdge}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path d={path} fill="none" stroke={COLORS.legend} strokeWidth={1.75} opacity={enabled ? 1 : 0.35} />
      {points.map((b, i) => (
        <Handle
          key={b.label}
          x={xs[i + 1]!}
          y={yOf(levels[i]!)}
          label={b.label}
          timeId={b.timeId}
          levelId={b.levelId}
          time={times[i]!}
          level={levels[i]!}
          levelMin={-99}
          levelMax={99}
          enabled={enabled}
          wellTop={box.y + PAD.t}
        />
      ))}
    </GraphFrame>
  );
}

/**
 * AMP EG. Levels are UNSIGNED and there is NO release level — the trace always falls to the
 * floor, because an amplifier envelope that released anywhere else would never stop
 * sounding and its slot would never be freed.
 *
 * Note what is missing relative to the filter graph: the release handle carries a time and
 * no level, because byte 98 is the last of the amp EG's seven and there is no byte 99 for
 * it to move.
 */
export function AmpEgGraph({ box, osc, enabled }: EgGraphProps) {
  const p = (id: string) => `OSC${osc}_${id}`;
  const points: Breakpoint[] = [
    { label: 'A', timeId: p('VDA_EG_AT'), levelId: p('VDA_EG_AL') },
    { label: 'D', timeId: p('VDA_EG_DT'), levelId: p('VDA_EG_BP') },
    { label: 'S', timeId: p('VDA_EG_ST'), levelId: p('VDA_EG_SL') },
    { label: 'R', timeId: p('VDA_EG_RT') },
  ];

  const times = [
    useParamNum(p('VDA_EG_AT')),
    useParamNum(p('VDA_EG_DT')),
    useParamNum(p('VDA_EG_ST')),
    useParamNum(p('VDA_EG_RT')),
  ];
  // THREE levels for FOUR segments. That is the missing eighth parameter, made visible.
  const levels = [
    useParamNum(p('VDA_EG_AL')),
    useParamNum(p('VDA_EG_BP')),
    useParamNum(p('VDA_EG_SL')),
  ];
  const xs = xPositions(times, box);

  const top = box.y + PAD.t;
  const height = box.h - PAD.t - PAD.b;
  const floor = top + height;
  // 0..99 from the floor upward. There is no centre line, because there is no signed range.
  const yOf = (level: number) => floor - (level / 99) * height;

  const path = [
    `M ${xs[0]} ${floor}`,
    `L ${xs[1]} ${yOf(levels[0]!)}`,
    `L ${xs[2]} ${yOf(levels[1]!)}`,
    `L ${xs[3]} ${yOf(levels[2]!)}`,
    // The release always lands on the floor. Not a parameter — a structural fact.
    `L ${xs[4]} ${floor}`,
  ].join(' ');

  return (
    <GraphFrame box={box} title={`AMP EG ${osc}`}>
      {segmentHeaders(box, ['ATTACK', 'DECAY', 'SLOPE', 'RELEASE'])}
      <path d={path} fill="none" stroke={COLORS.legend} strokeWidth={1.75} opacity={enabled ? 1 : 0.35} />
      {points.map((b, i) => (
        <Handle
          key={b.label}
          x={xs[i + 1]!}
          y={b.levelId ? yOf(levels[i]!) : floor}
          label={b.label}
          timeId={b.timeId}
          levelId={b.levelId}
          time={times[i]!}
          level={levels[i] ?? 0}
          levelMin={0}
          levelMax={99}
          enabled={enabled}
          wellTop={box.y + PAD.t}
        />
      ))}
    </GraphFrame>
  );
}
