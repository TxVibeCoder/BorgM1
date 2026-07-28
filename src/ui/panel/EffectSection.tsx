/**
 * The `INSERT FX` page — the two master effect slots and their routing. UI-SPEC §3.
 *
 * WHY THIS IS NOT `Section.tsx`. Every other section declares a FIXED list of parameter ids
 * and lets `layout.ts` place them. An effect slot cannot: which parameters exist depends on
 * which of the 33 algorithms is loaded, and selecting a new one replaces the whole set
 * (manual p.56 — the hardware resets them to defaults). So this component reads the parameter
 * list from the algorithm at render time and flows it through the SAME `cellAt` grid, which
 * keeps the "sections declare WHICH, never WHERE" rule intact even though the WHICH is
 * dynamic.
 *
 * THE PAIRING RESTRICTION IS VISIBLE, NOT SILENT. Selecting Symphonic Ensemble or Rotary
 * Speaker while the other slot holds an asterisked modulation effect is barred by the
 * hardware, so the stepper SKIPS the barred entries rather than accepting the choice and
 * having it rejected somewhere the user cannot see.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  allowedTypesAgainst,
  effectAlgorithm,
  toEffectControlDef,
  EFFECT_NAMES,
  type EffectParamDef,
} from '../../../data/effectParams';
import type { ControlDef } from '../../../data/schema';
import { engineBridge } from '../../engine/engineBridge';
import { m1Store } from '../../state/store';
import { Knob } from '../controls/Knob';
import { Switch } from '../controls/Switch';
import type { RegionBox } from '../stage';
import { ACCENT, COLORS, FONT_CONDENSED, SECTION_BORDER_WIDTH } from '../theme';
import { useEffectBalance, useEffectParam, useEffectSerial, useEffectType } from '../useControl';
import { cellAt, columnsFor, OSC_LABEL_W, SECTION_PAD, SECTION_TITLE_H } from './layout';

/** Height of the algorithm selector strip at the top of a slot box. */
const SELECTOR_H = 30;

// ---- one effect parameter ------------------------------------------------------------------

function EffectParam({
  slot,
  def,
  x,
  y,
}: {
  slot: 1 | 2;
  def: EffectParamDef;
  x: number;
  y: number;
}) {
  const value = useEffectParam(slot, def.id);
  const control = toEffectControlDef(def) as ControlDef;

  const onInput = useCallback(
    (v: number) => engineBridge.previewEffectParam(slot, def.id, v),
    [slot, def.id],
  );
  const onCommit = useCallback(
    (v: number) => engineBridge.setEffectParam(slot, def.id, v),
    [slot, def.id],
  );
  const onChange = useCallback(
    (pos: string) => {
      // The frequency selectors carry NUMERIC positions (250 / 500 / 1000 Hz), so the
      // switch's string has to go back as a number or the codec will not recognise it.
      const numeric = Number(pos);
      engineBridge.setEffectParam(slot, def.id, Number.isNaN(numeric) ? pos : numeric);
    },
    [slot, def.id],
  );

  if (control.type === 'switch') {
    return <Switch def={control} value={String(value)} onChange={onChange} x={x} y={y} />;
  }
  return (
    <Knob
      def={control}
      value={typeof value === 'number' ? value : 0}
      onInput={onInput}
      onCommit={onCommit}
      x={x}
      y={y}
      accent={COLORS.knob}
    />
  );
}

// ---- the algorithm selector ------------------------------------------------------------------

function EffectSelector({
  slot,
  type,
  otherType,
  x,
  y,
  w,
}: {
  slot: 1 | 2;
  type: number;
  otherType: number;
  x: number;
  y: number;
  w: number;
}) {
  // The barred entries are removed from the cycle entirely, so stepping can never land on a
  // pair the hardware refuses. M1R manual p.57.
  const allowed = allowedTypesAgainst(otherType);
  const here = Math.max(0, allowed.indexOf(type));

  const step = (delta: number): void => {
    const next = allowed[(here + delta + allowed.length) % allowed.length];
    if (next !== undefined) engineBridge.setEffectType(slot, next);
  };

  const btnW = 22;
  const fieldW = w - btnW * 2 - 6;
  return (
    <g>
      {/* Green LCD name field, UI-SPEC §3's "dropdown reading `Exciter`". The recess colour
          and the green are existing theme tokens rather than new ones — the theme and
          styles.css are a matched pair, and this needs no colour they do not already have. */}
      <rect
        x={x}
        y={y}
        width={fieldW}
        height={SELECTOR_H}
        rx={3}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
      />
      <text
        x={x + 8}
        y={y + SELECTOR_H / 2}
        fill={ACCENT.selected}
        fontFamily={FONT_CONDENSED}
        fontSize={13}
        letterSpacing={0.5}
        dominantBaseline="middle"
      >
        {EFFECT_NAMES[type] ?? 'NO EFFECT'}
      </text>
      {[
        { label: '▲', delta: 1, dx: fieldW + 3 },
        { label: '▼', delta: -1, dx: fieldW + 3 + btnW + 3 },
      ].map((b) => (
        <g
          key={b.label}
          role="button"
          tabIndex={0}
          aria-label={`Effect ${slot} ${b.delta > 0 ? 'next' : 'previous'}`}
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.preventDefault();
            step(b.delta);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') step(b.delta);
          }}
        >
          <rect
            x={x + b.dx}
            y={y}
            width={btnW}
            height={SELECTOR_H}
            rx={3}
            fill={COLORS.panelRaised}
            stroke={COLORS.panelEdge}
          />
          <text
            x={x + b.dx + btnW / 2}
            y={y + SELECTOR_H / 2}
            fill={COLORS.legend}
            fontFamily={FONT_CONDENSED}
            fontSize={10}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {b.label}
          </text>
        </g>
      ))}
    </g>
  );
}

// ---- one slot ---------------------------------------------------------------------------------

export function EffectSlotSection({ slot, box }: { slot: 1 | 2; box: RegionBox }) {
  const type = useEffectType(slot);
  const otherType = useEffectType(slot === 1 ? 2 : 1);
  const serial = useEffectSerial();
  const algo = effectAlgorithm(type);

  const contentX = box.x + SECTION_PAD + OSC_LABEL_W;
  const contentY = box.y + SECTION_TITLE_H + SELECTOR_H + 8;
  const cols = columnsFor(box.w);

  /**
   * PROGRAM MODE CANNOT REACH EFFECT 2 IN PARALLEL, and the panel says so rather than
   * leaving a live-looking row of knobs that change nothing. See effectChainCore.ts — a
   * program is hard-wired 5:5 into buses A/B, and in PARALLEL the A/B path stops at
   * effect 1. It is the hardware, not a fault, so it is labelled instead of hidden.
   */
  const unreachable = slot === 2 && !serial && type !== 0;

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
        {`EFFECT ${slot}`}
      </text>
      {unreachable && (
        <text
          x={box.x + box.w - SECTION_PAD}
          y={box.y + 14}
          fill={COLORS.ledAmber}
          fontFamily={FONT_CONDENSED}
          fontSize={10}
          textAnchor="end"
          letterSpacing={0.5}
        >
          NOT IN PATH — PARALLEL
        </text>
      )}

      <EffectSelector
        slot={slot}
        type={type}
        otherType={otherType}
        x={box.x + SECTION_PAD}
        y={box.y + SECTION_TITLE_H - 2}
        w={box.w - SECTION_PAD * 2}
      />

      <g opacity={unreachable ? 0.35 : 1}>
        {algo?.params.map((p, i) => {
          const pos = cellAt(i, cols, contentX, contentY);
          return <EffectParam key={p.id} slot={slot} def={p} x={pos.x} y={pos.y} />;
        })}

        {/* The two balances. `Dry:EFF` is a SLOT parameter, not an algorithm parameter —
            which is why it sits here rather than in the parameter grid, and why its label
            changes: for the dual algorithms 26-33 the pair is the two halves' dry/wet
            rather than a left/right pair. */}
        {algo && (
          <>
            <BalanceKnob
              slot={slot}
              which="A"
              label={algo.dual ? 'DLY DRY:EFF' : 'DRY:EFF L'}
              {...cellAt(algo.params.length, cols, contentX, contentY)}
            />
            <BalanceKnob
              slot={slot}
              which="B"
              label={algo.dual ? 'TAIL DRY:EFF' : 'DRY:EFF R'}
              {...cellAt(algo.params.length + 1, cols, contentX, contentY)}
            />
          </>
        )}
      </g>
    </g>
  );
}

const BALANCE_DEF = (label: string): ControlDef => ({
  id: `BALANCE_${label}`,
  panelLabel: label,
  type: 'knob',
  min: 0,
  max: 100,
  default: 0,
  taper: 'lin',
  unit: '%',
});

function BalanceKnob({
  slot,
  which,
  label,
  x,
  y,
}: {
  slot: 1 | 2;
  which: 'A' | 'B';
  label: string;
  x: number;
  y: number;
}) {
  const value = useEffectBalance(slot, which);
  return (
    <Knob
      def={BALANCE_DEF(label)}
      value={value}
      onInput={(v) => engineBridge.previewEffectBalance(slot, which, v)}
      onCommit={(v) => engineBridge.setEffectBalance(slot, which, v)}
      x={x}
      y={y}
      accent={ACCENT.edit}
    />
  );
}

// ---- routing ------------------------------------------------------------------------------------

const ROUTING_DEF: ControlDef = {
  id: 'FX_ROUTING',
  panelLabel: 'PLACEMENT',
  type: 'switch',
  positions: ['PARALLEL', 'SERIAL'],
  default: 'SERIAL',
};

const IO_DEFS: { id: 'fx1L' | 'fx1R' | 'fx2L' | 'fx2R'; label: string }[] = [
  { id: 'fx1L', label: 'FX1 L' },
  { id: 'fx1R', label: 'FX1 R' },
  { id: 'fx2L', label: 'FX2 L' },
  { id: 'fx2R', label: 'FX2 R' },
];

export function EffectRoutingSection({ box }: { box: RegionBox }) {
  const serial = useEffectSerial();
  const contentX = box.x + SECTION_PAD + OSC_LABEL_W;
  const contentY = box.y + SECTION_TITLE_H;
  const cols = columnsFor(box.w);

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
        EFFECT PLACEMENT
      </text>

      <Switch
        def={ROUTING_DEF}
        value={serial ? 'SERIAL' : 'PARALLEL'}
        onChange={(pos) => engineBridge.setEffectRouting(pos === 'SERIAL')}
        {...cellAt(0, cols, contentX, contentY)}
      />
      {IO_DEFS.map((io, i) => (
        <IoSwitch key={io.id} id={io.id} label={io.label} {...cellAt(i + 1, cols, contentX, contentY)} />
      ))}

      <text
        x={box.x + SECTION_PAD}
        y={box.y + box.h - 10}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={9}
      >
        {serial
          ? 'A,B → FX1 → FX2 → 1/L, 2/R'
          : 'A,B → FX1 → 1/L, 2/R    (FX2 is fed from C,D)'}
      </text>
    </g>
  );
}

function IoSwitch({
  id,
  label,
  x,
  y,
}: {
  id: 'fx1L' | 'fx1R' | 'fx2L' | 'fx2R';
  label: string;
  x: number;
  y: number;
}) {
  const on = useEffectIo(id);
  const def: ControlDef = {
    id,
    panelLabel: label,
    type: 'switch',
    positions: ['OFF', 'ON'],
    default: 'ON',
  };
  return (
    <Switch
      def={def}
      value={on ? 'ON' : 'OFF'}
      onChange={(pos) => engineBridge.setEffectIo(id, pos === 'ON')}
      x={x}
      y={y}
    />
  );
}

/** One channel-enable bit. Local, because this is the only place a single one is read. */
function useEffectIo(id: 'fx1L' | 'fx1R' | 'fx2L' | 'fx2R'): boolean {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.effects[id],
    () => m1Store.effects[id],
  );
}
