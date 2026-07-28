/**
 * One program parameter, rendered as the control its ControlDef asks for and bound to the
 * store and the engine.
 *
 * DATA FLOW, per src/ui/CONVENTIONS.md:
 *   - `onInput` (every pointermove of a knob drag) -> immediate imperative engine write.
 *   - `onCommit` (release / double-click) -> one store write.
 *   - discrete controls write engine and store together, no debounce.
 *
 * The bridge's `setParam` does both halves, which is right for switches and for the commit,
 * but WRONG for the continuous case: writing the store on every pointermove would notify
 * every subscriber 60 times a second. So the drag path calls `previewParam`, which pushes
 * the engine without touching the store, and only the commit writes state.
 *
 * DISABLED IS DESIGNED, NOT BOLTED ON (UI-SPEC §9). About a third of the panel greys in
 * SINGLE mode, so the disabled treatment is a first-class branch here: same layout, same
 * position, reduced luminance, and genuinely non-interactive — not merely dimmed, because a
 * control that looks off but still responds is worse than either.
 */

import { useCallback } from 'react';
import { engineBridge } from '../../engine/engineBridge';
import { programParam, toControlDef } from '../../../data/programParams';
import { Knob } from '../controls/Knob';
import { Switch } from '../controls/Switch';
import { useControl } from '../useControl';
import { COLORS } from '../theme';

export interface ParamControlProps {
  id: string;
  x: number;
  y: number;
  enabled?: boolean;
}

/** Same hue at ~35% luminance, the disabled treatment measured in UI-SPEC §7. */
const DISABLED_OPACITY = 0.35;

export function ParamControl({ id, x, y, enabled = true }: ParamControlProps) {
  const value = useControl(id);
  const def = toControlDef(programParam(id));

  const onInput = useCallback((v: number) => engineBridge.previewParam(id, v), [id]);
  const onCommit = useCallback((v: number) => engineBridge.setParam(id, v), [id]);
  const onChange = useCallback((pos: string) => engineBridge.setParam(id, pos), [id]);

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
