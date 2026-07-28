/**
 * A titled section of Combination parameters, bound to the SELECTED timbre.
 *
 * The Combination twin of `Section.tsx`, and it differs in exactly one way: where the program
 * panel's `1`/`2` rule renders a section twice against two oscillators, this renders it ONCE
 * against whichever of the eight timbres the strip has selected. The strip is the selector, so
 * the section does not need eight copies — which is also why UI-SPEC gives the left column to
 * the strip and the centre to one timbre's detail.
 *
 * The type-dependent parameter — SPLIT POINT or VELOCITY SWITCH POINT — is rendered here too,
 * and it is the one control in the panel with no byte of its own: it is a view over the two
 * timbres' windows (see `SPLIT_POINT_DERIVED` in `combiParams`).
 */

import { useCallback } from 'react';
import {
  combiParam,
  toCombiControlDef,
  writeSplitPoint,
  writeVelSwitchPoint,
} from '../../../data/combiParams';
import { engineBridge } from '../../engine/engineBridge';
import { m1Store } from '../../state/store';
import { Knob } from '../controls/Knob';
import { Switch } from '../controls/Switch';
import type { RegionBox } from '../stage';
import { COLORS, FONT_CONDENSED, SECTION_BORDER_WIDTH } from '../theme';
import { useCombiParam, useCombiType } from '../useCombi';
import {
  CELL,
  cellAt,
  columnsFor,
  rowsFor,
  SECTION_PAD,
  type CombiSection as CombiSectionSpec,
} from './layout';

const DISABLED_OPACITY = 0.35;

/**
 * Title clearance, TALLER than the program panel's `SECTION_TITLE_H`.
 *
 * `COMBI_TYPE` is a FIVE-position switch — the tallest control in the instrument — and a
 * switch draws its label above the slot, so the taller the switch the higher its label
 * reaches. At the program panel's 20 px the label printed straight through the section title,
 * which the rendered-page audit caught and no unit test could: the switch fits its cell
 * perfectly, and the collision is with the box the cell sits in.
 *
 * Phase 4 met the same class of bug with the 4-position waveform switch, whose label pokes 3px
 * over its cell top, and solved it by keeping that switch out of column 0. A fifth position
 * puts it out of reach of that trick, so the band grows instead.
 */
const COMBI_TITLE_H = 34;

/** One combination parameter, bound to the store and the engine. */
export function CombiParamControl({
  id,
  x,
  y,
  enabled = true,
}: {
  id: string;
  x: number;
  y: number;
  enabled?: boolean;
}) {
  const value = useCombiParam(id);
  const def = toCombiControlDef(combiParam(id));

  const onInput = useCallback((v: number) => engineBridge.previewCombiParam(id, v), [id]);
  const onCommit = useCallback((v: number) => engineBridge.setCombiParam(id, v), [id]);
  const onChange = useCallback((pos: string) => engineBridge.setCombiParam(id, pos), [id]);

  const control =
    def.type === 'switch' ? (
      <Switch def={def} value={String(value)} onChange={onChange} x={x} y={y} />
    ) : (
      <Knob
        def={def}
        value={typeof value === 'number' ? value : Number(def.default ?? 0)}
        onInput={onInput}
        onCommit={onCommit}
        x={x}
        y={y}
        accent={COLORS.knob}
      />
    );

  if (enabled) return control;
  return (
    <g opacity={DISABLED_OPACITY} style={{ pointerEvents: 'none' }} aria-hidden="true">
      {control}
    </g>
  );
}

/**
 * SPLIT POINT / VELOCITY SWITCH POINT — the derived control.
 *
 * Reads back from timbre 2's window edge and writes BOTH timbres' edges, so the two halves
 * stay contiguous exactly as Korg's own factory SPLITs store them. It has no entry in
 * `COMBI_PARAMS` because it has no byte; giving it one would have meant inventing a byte, and
 * TABLE 6's footnote *14 is precisely the trap of believing it has.
 */
function DerivedPointControl({ x, y, kind }: { x: number; y: number; kind: 'SPLIT' | 'VEL' }) {
  // Subscribe to the two parameters the value is derived from, so it tracks their edits.
  const t2KeyBottom = useCombiParam('T2_KEY_BOTTOM');
  const t2VelBottom = useCombiParam('T2_VEL_BOTTOM');
  const isSplit = kind === 'SPLIT';
  const value = isSplit ? Number(t2KeyBottom) : Number(t2VelBottom);

  const write = useCallback(
    (v: number, commit: boolean) => {
      const params = m1Store.getState().combi.params;
      const patch = isSplit ? writeSplitPoint(params, v) : writeVelSwitchPoint(params, v);
      const keys = isSplit
        ? ['T1_KEY_BOTTOM', 'T1_KEY_TOP', 'T2_KEY_BOTTOM', 'T2_KEY_TOP']
        : ['T1_VEL_BOTTOM', 'T1_VEL_TOP', 'T2_VEL_BOTTOM', 'T2_VEL_TOP'];
      const slice = Object.fromEntries(keys.map((k) => [k, patch[k]!]));
      if (commit) engineBridge.setCombiParams(slice);
      else for (const [k, val] of Object.entries(slice)) engineBridge.previewCombiParam(k, val);
    },
    [isSplit],
  );

  const def = {
    id: isSplit ? 'SPLIT_POINT' : 'VEL_SWITCH_POINT',
    panelLabel: isSplit ? 'SPLIT' : 'VEL SW',
    type: 'knob' as const,
    min: isSplit ? 0 : 1,
    max: 127,
    default: isSplit ? 60 : 64,
    taper: 'lin' as const,
  };

  return (
    <Knob
      def={def}
      value={value}
      onInput={(v) => write(v, false)}
      onCommit={(v) => write(v, true)}
      x={x}
      y={y}
      accent={COLORS.knob}
    />
  );
}

export interface CombiSectionProps {
  section: CombiSectionSpec;
  box: RegionBox;
  /** Which timbre row the strip has selected. Per-timbre parameters bind to it. */
  timbre: number;
  /** False for a row the current type does not use — the whole section greys. */
  enabled: boolean;
}

export function CombiSection({ section, box, timbre, enabled }: CombiSectionProps) {
  const type = useCombiType();
  // The hosting section grows the type's own extra parameter, and only that type's.
  const extra = !section.hostsDerivedPoint
    ? null
    : type === 'SPLIT'
      ? 'SPLIT'
      : type === 'VELOCITY SWITCH'
        ? 'VEL'
        : null;
  const items = [...section.params, ...(extra ? ['__DERIVED__'] : [])];
  const cols = columnsFor(box.w, section.columns);
  const contentX = box.x + SECTION_PAD;
  const contentY = box.y + COMBI_TITLE_H;

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
        strokeWidth={SECTION_BORDER_WIDTH / 2}
      />
      <text
        x={box.x + SECTION_PAD}
        y={box.y + 14}
        fill={COLORS.legend}
        fontFamily={FONT_CONDENSED}
        fontSize={12}
        letterSpacing={1.5}
      >
        {section.global ? section.title : `${section.title} — T${timbre + 1}`}
      </text>
      {items.map((param, i) => {
        const pos = cellAt(i, cols, contentX, contentY);
        if (param === '__DERIVED__') {
          return <DerivedPointControl key={param} x={pos.x} y={pos.y} kind={extra!} />;
        }
        return (
          <CombiParamControl
            key={param}
            id={section.global ? param : `T${timbre + 1}_${param}`}
            x={pos.x}
            y={pos.y}
            enabled={section.global || enabled}
          />
        );
      })}
    </g>
  );
}

/** Height a combination section needs, in the same shape `flowSections` expects. */
export function combiSectionHeight(section: CombiSectionSpec, width: number, extra: number): number {
  const cols = columnsFor(width, section.columns);
  const rows = rowsFor(section.params.length + extra, cols);
  return COMBI_TITLE_H + rows * CELL.h + SECTION_PAD;
}
