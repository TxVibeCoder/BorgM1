/**
 * The 8-row timbre strip — UI-SPEC §3's left column, and the face of Combination mode.
 *
 * Per row, left to right: the row number, a `SOLO` / `MUTE` / `IFX` / `v` button cluster, the
 * program name field, `LEVEL` with a slider beneath, `PAN` with a small rotary, and the `OUT`
 * dropdown. The selected row carries a green bar on its outer edge.
 *
 * IT DOES NOT USE THE PANEL'S KNOBS, and that is deliberate rather than a shortcut. UI-SPEC
 * measured this column as sliders, small rotaries and dropdowns — a different control idiom
 * from the knob grid — and eight rows of six controls at 58 px each is exactly the density at
 * which a 66 px knob cell stops fitting. Every coordinate comes from `TIMBRE_ROW` in
 * `layout.ts` so the rendered-page audit can check the row rather than trust it.
 *
 * `OUT` IS A VIEW OF THE PANPOT, NOT A SECOND CONTROL. The hardware has one 14-position
 * panpot; `1+2` is its A/B half and `3+4` is its C/C+D/D half. Rendering them as two controls
 * over one byte is what the reference plugin does, and holding no state of its own is what
 * keeps them from disagreeing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PANPOT_POSITIONS,
  panpotIsCd,
  PANPOT_CENTRE,
  PROGRAM_REFS,
  timbresInType,
  TIMBRE_COUNT,
} from '../../../data/combiParams';
import { engineBridge } from '../../engine/engineBridge';
import { timbreIsSilent, windowIsEmpty } from '../../engine/program/combiConfigCore';
import { m1Store } from '../../state/store';
import type { RegionBox } from '../stage';
import { ACCENT, COLORS, FONT_CONDENSED, SECTION_BORDER_WIDTH } from '../theme';
import { useAnySolo, useCombiType, useTimbreParam, useTimbreSolo } from '../useCombi';
import { TIMBRE_ROW } from './layout';

const MONO = "'DejaVu Sans Mono', 'Consolas', monospace";
/** Same hue at ~35% luminance — the disabled treatment measured in UI-SPEC §7. */
const DISABLED_OPACITY = 0.35;

export interface TimbreStripProps {
  box: RegionBox;
  selected: number;
  onSelect: (timbre: number) => void;
}

/**
 * Pointer drag over a horizontal or vertical span, in design px.
 *
 * Written here rather than reusing the knob's drag because the two ergonomics genuinely
 * differ: a slider tracks the pointer's ABSOLUTE position along its own track, a knob tracks
 * RELATIVE vertical travel. Sharing one would make one of them feel wrong.
 */
function useTrackDrag(onMove: (fraction: number) => void, onEnd: (fraction: number) => void) {
  const state = useRef<{ x0: number; w: number; last: number } | null>(null);

  const compute = useCallback((clientX: number): number => {
    const s = state.current;
    if (!s) return 0;
    const f = Math.min(1, Math.max(0, (clientX - s.x0) / Math.max(1, s.w)));
    s.last = f;
    return f;
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!state.current) return;
      onMove(compute(e.clientX));
    };
    const up = () => {
      if (!state.current) return;
      const f = state.current.last;
      state.current = null;
      onEnd(f);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [compute, onMove, onEnd]);

  return useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      // The track's on-screen rect, so the drag survives the stage's uniform scale.
      const rect = (e.currentTarget as SVGGraphicsElement).getBoundingClientRect();
      state.current = { x0: rect.left, w: rect.width, last: 0 };
      onMove(compute(e.clientX));
      e.preventDefault();
    },
    [compute, onMove],
  );
}

/** A small square button. The strip's own idiom — flat, compact, and captioned in place. */
function StripButton({
  x,
  y,
  label,
  on,
  enabled = true,
  accent = ACCENT.edit,
  title,
  onClick,
}: {
  x: number;
  y: number;
  label: string;
  on: boolean;
  enabled?: boolean;
  accent?: string;
  title?: string;
  onClick: () => void;
}) {
  const { buttonW: w, buttonH: h } = TIMBRE_ROW;
  return (
    <g
      role="switch"
      aria-checked={on}
      aria-label={title ?? label}
      aria-disabled={!enabled}
      tabIndex={enabled ? 0 : -1}
      style={{ cursor: enabled ? 'pointer' : 'default' }}
      opacity={enabled ? 1 : DISABLED_OPACITY}
      onClick={enabled ? onClick : undefined}
      onKeyDown={(e) => {
        if (enabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {title && <title>{title}</title>}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={on ? accent : COLORS.panelShadow}
        stroke={on ? accent : COLORS.panelEdge}
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 + 3.5}
        fill={on ? COLORS.bg : COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={9}
        letterSpacing={0.4}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

/** The program-name field: a stepper on either side of a monospace readout. */
function ProgramField({
  x,
  y,
  timbre,
  enabled,
}: {
  x: number;
  y: number;
  timbre: number;
  enabled: boolean;
}) {
  const value = String(useTimbreParam(timbre, 'PROGRAM'));
  const id = `T${timbre + 1}_PROGRAM`;
  const w = TIMBRE_ROW.nameW;
  const type = useCombiType();
  // OFF is a position only MULTI can express — note *12 gives it a byte only there.
  const options = type === 'MULTI' ? ['OFF', ...PROGRAM_REFS] : PROGRAM_REFS;

  const step = (dir: 1 | -1) => {
    const i = Math.max(0, options.indexOf(value));
    const next = options[(i + dir + options.length) % options.length];
    if (next) engineBridge.setCombiParam(id, next);
  };

  return (
    <g opacity={enabled ? 1 : DISABLED_OPACITY} style={{ pointerEvents: enabled ? 'auto' : 'none' }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={26}
        rx={3}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
        strokeWidth={1}
      />
      {([-1, 1] as const).map((dir) => (
        <g
          key={dir}
          role="button"
          tabIndex={0}
          aria-label={`Timbre ${timbre + 1} program ${dir > 0 ? 'up' : 'down'}`}
          style={{ cursor: 'pointer' }}
          onClick={() => step(dir)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              step(dir);
            }
          }}
        >
          <rect
            x={dir < 0 ? x + 1 : x + w - 15}
            y={y + 1}
            width={14}
            height={24}
            rx={2}
            fill="transparent"
          />
          <text
            x={dir < 0 ? x + 8 : x + w - 8}
            y={y + 17}
            fill={COLORS.legendDim}
            fontFamily={FONT_CONDENSED}
            fontSize={11}
            textAnchor="middle"
          >
            {dir < 0 ? '◀' : '▶'}
          </text>
        </g>
      ))}
      <text
        x={x + w / 2}
        y={y + 17}
        fill={value === 'OFF' ? COLORS.legendDim : ACCENT.edit}
        fontFamily={MONO}
        fontSize={13}
        textAnchor="middle"
      >
        {value === 'OFF' ? '- - - -' : value}
      </text>
    </g>
  );
}

/** LEVEL: a numeric readout with a horizontal slider beneath it (UI-SPEC §3). */
function LevelSlider({
  x,
  y,
  timbre,
  enabled,
}: {
  x: number;
  y: number;
  timbre: number;
  enabled: boolean;
}) {
  const value = Number(useTimbreParam(timbre, 'LEVEL'));
  const id = `T${timbre + 1}_LEVEL`;
  const w = TIMBRE_ROW.levelW;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;

  // Drag previews through the engine without a store write, and commits once on release —
  // the same split ParamControl makes, for the same reason.
  const onMove = useCallback(
    (f: number) => {
      const v = Math.round(f * 99);
      setDrag(v);
      engineBridge.previewCombiParam(id, v);
    },
    [id],
  );
  const onEnd = useCallback(
    (f: number) => {
      setDrag(null);
      engineBridge.setCombiParam(id, Math.round(f * 99));
    },
    [id],
  );
  const onPointerDown = useTrackDrag(onMove, onEnd);

  return (
    <g opacity={enabled ? 1 : DISABLED_OPACITY} style={{ pointerEvents: enabled ? 'auto' : 'none' }}>
      <text
        x={x}
        y={y + 9}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={8}
        letterSpacing={0.8}
      >
        LEVEL
      </text>
      <text
        x={x + w}
        y={y + 9}
        fill={COLORS.legend}
        fontFamily={MONO}
        fontSize={11}
        textAnchor="end"
      >
        {String(shown).padStart(2, '0')}
      </text>
      <rect
        role="slider"
        aria-label={`Timbre ${timbre + 1} level`}
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={99}
        tabIndex={enabled ? 0 : -1}
        x={x}
        y={y + 14}
        width={w}
        height={10}
        rx={3}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
        strokeWidth={1}
        style={{ cursor: 'ew-resize' }}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          engineBridge.setCombiParam(id, Math.min(99, Math.max(0, value + d)));
        }}
      />
      <rect
        x={x + 1.5}
        y={y + 15.5}
        width={Math.max(0, ((w - 3) * shown) / 99)}
        height={7}
        rx={2}
        fill={ACCENT.edit}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
}

/** PAN: a small rotary with its 14-position value beside it. */
function PanRotary({
  x,
  y,
  timbre,
  enabled,
}: {
  x: number;
  y: number;
  timbre: number;
  enabled: boolean;
}) {
  const value = String(useTimbreParam(timbre, 'PAN'));
  const id = `T${timbre + 1}_PAN`;
  const index = Math.max(0, PANPOT_POSITIONS.indexOf(value as never));
  const cx = x + 13;
  const cy = y + 15;
  const r = 11;
  // -135deg at position 0 to +135deg at 13 — the same sweep the panel's knobs use.
  const angle = -135 + (index / (PANPOT_POSITIONS.length - 1)) * 270;
  const rad = ((angle - 90) * Math.PI) / 180;

  const step = (dir: 1 | -1) => {
    const next = PANPOT_POSITIONS[Math.min(PANPOT_POSITIONS.length - 1, Math.max(0, index + dir))];
    if (next) engineBridge.setCombiParam(id, next);
  };

  return (
    <g opacity={enabled ? 1 : DISABLED_OPACITY} style={{ pointerEvents: enabled ? 'auto' : 'none' }}>
      <g
        role="slider"
        aria-label={`Timbre ${timbre + 1} pan`}
        aria-valuenow={index}
        aria-valuemin={0}
        aria-valuemax={PANPOT_POSITIONS.length - 1}
        aria-valuetext={value}
        tabIndex={enabled ? 0 : -1}
        style={{ cursor: 'pointer' }}
        onClick={(e) => step(e.clientX > e.currentTarget.getBoundingClientRect().left + r ? 1 : -1)}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          step(d);
        }}
      >
        <circle cx={cx} cy={cy} r={r} fill={COLORS.knob} stroke={COLORS.knobLo} strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={r - 3} fill={COLORS.knobHi} opacity={0.25} />
        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.cos(rad) * (r - 2)}
          y2={cy + Math.sin(rad) * (r - 2)}
          stroke={COLORS.knobPointer}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
      <text
        x={x + 30}
        y={y + 12}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={8}
        letterSpacing={0.8}
      >
        PAN
      </text>
      <text
        x={x + 30}
        y={y + 24}
        fill={panpotIsCd(index) ? ACCENT.selected : COLORS.legend}
        fontFamily={MONO}
        fontSize={11}
      >
        {value}
      </text>
    </g>
  );
}

/**
 * OUT: `1+2` or `3+4`, a two-position view of the panpot.
 *
 * Switching to `3+4` parks the panpot on `C+D` and switching back parks it on `5:5`, so the
 * two controls always agree because only one of them holds state. Note `3+4` is only AUDIBLE
 * when the effect section's Output 3/4 pans are set — that is the hardware, and 37 of Korg's
 * 100 factory combinations leave them at OFF because they expected a mixer there.
 */
function OutSelect({
  x,
  y,
  timbre,
  enabled,
}: {
  x: number;
  y: number;
  timbre: number;
  enabled: boolean;
}) {
  const value = String(useTimbreParam(timbre, 'PAN'));
  const id = `T${timbre + 1}_PAN`;
  const index = Math.max(0, PANPOT_POSITIONS.indexOf(value as never));
  const cd = panpotIsCd(index);
  const w = TIMBRE_ROW.outW;

  return (
    <g opacity={enabled ? 1 : DISABLED_OPACITY} style={{ pointerEvents: enabled ? 'auto' : 'none' }}>
      <text
        x={x}
        y={y + 9}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={8}
        letterSpacing={0.8}
      >
        OUT
      </text>
      <g
        role="button"
        aria-label={`Timbre ${timbre + 1} output bus`}
        tabIndex={enabled ? 0 : -1}
        style={{ cursor: 'pointer' }}
        onClick={() =>
          engineBridge.setCombiParam(id, PANPOT_POSITIONS[cd ? PANPOT_CENTRE : 12]!)
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            engineBridge.setCombiParam(id, PANPOT_POSITIONS[cd ? PANPOT_CENTRE : 12]!);
          }
        }}
      >
        <rect
          x={x}
          y={y + 13}
          width={w}
          height={20}
          rx={3}
          fill={COLORS.panelShadow}
          stroke={COLORS.panelEdge}
          strokeWidth={1}
        />
        <text
          x={x + w / 2}
          y={y + 27}
          fill={cd ? ACCENT.selected : COLORS.legend}
          fontFamily={MONO}
          fontSize={11}
          textAnchor="middle"
        >
          {cd ? '3+4' : '1+2'}
        </text>
      </g>
    </g>
  );
}

function TimbreRow({
  box,
  timbre,
  live,
  selected,
  onSelect,
}: {
  box: RegionBox;
  timbre: number;
  live: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const R = TIMBRE_ROW;
  const off = String(useTimbreParam(timbre, 'TIMBRE_OFF')) === 'OFF';
  const solo = useTimbreSolo(timbre);
  const anySolo = useAnySolo();
  // Subscribing to the four fields that decide it keeps this row re-rendering only when its
  // own silence changes, rather than on every store write.
  void useTimbreParam(timbre, 'LEVEL');
  void useTimbreParam(timbre, 'PROGRAM');
  void useTimbreParam(timbre, 'VEL_TOP');
  void useTimbreParam(timbre, 'KEY_TOP');
  const params = m1Store.getState().combi.params;
  const silent = live && timbreIsSilent(params, timbre, m1Store.getState().combi.solo);
  const emptyWindow = live && windowIsEmpty(params, timbre);

  const y = box.y;
  const buttonY = y + 8;
  const bx = (i: number): number => box.x + R.buttonsX + i * (R.buttonW + R.buttonGap);

  return (
    <g>
      {/* Row body. Clicking anywhere that is not a control selects the timbre. */}
      <rect
        role="button"
        aria-label={`Select timbre ${timbre + 1}`}
        aria-pressed={selected}
        tabIndex={0}
        x={box.x}
        y={y}
        width={box.w}
        height={R.h}
        rx={4}
        fill={selected ? COLORS.panelRaised : COLORS.panel}
        stroke={selected ? ACCENT.selected : COLORS.panelEdge}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      />
      {/* The green edge bar marking the selected row — UI-SPEC §3. */}
      {selected && (
        <rect x={box.x} y={y + 3} width={R.barW} height={R.h - 6} rx={2} fill={ACCENT.selected} />
      )}

      <text
        x={box.x + R.numX}
        y={y + R.h / 2 + 4}
        fill={selected ? ACCENT.selected : COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={13}
        fontWeight={600}
        textAnchor="middle"
      >
        {timbre + 1}
      </text>

      {/* Touching ANY control in a row selects it, on the capture phase so the control still
          gets its own click. The row's background rect is the nominal selector, but half of it
          is covered by controls — including, at its exact centre, the program stepper. */}
      <g
        opacity={live ? 1 : DISABLED_OPACITY}
        style={{ pointerEvents: live ? 'auto' : 'none' }}
        onPointerDownCapture={onSelect}
      >
        <StripButton
          x={bx(0)}
          y={buttonY}
          label="SOLO"
          on={solo}
          accent={ACCENT.selected}
          title={`Solo timbre ${timbre + 1}`}
          onClick={() => engineBridge.setTimbreSolo(timbre, !solo)}
        />
        <StripButton
          x={bx(1)}
          y={buttonY}
          label="MUTE"
          on={off}
          accent={COLORS.ledRed}
          title={`Mute timbre ${timbre + 1} (TIMBRE ON/OFF)`}
          onClick={() => engineBridge.setCombiParam(`T${timbre + 1}_TIMBRE_OFF`, off ? 'ON' : 'OFF')}
        />
        {/* IFX is a PLUGIN-ERA EXTENSION the 1988 hardware has no equivalent for, and it is
            not implemented. It ships visibly inert rather than absent, because a control that
            looks live and does nothing is worse than either (UI-SPEC §11 also records that
            whether it is a send or a toggle is still unresolved). */}
        <StripButton
          x={bx(2)}
          y={buttonY}
          label="IFX"
          on={false}
          enabled={false}
          title="Insert FX — a plugin-era extension, not implemented"
          onClick={() => undefined}
        />
        <StripButton
          x={bx(3)}
          y={buttonY}
          label="▼"
          on={selected}
          title={`Edit timbre ${timbre + 1}`}
          onClick={onSelect}
        />

        <ProgramField x={box.x + R.nameX} y={y + 8} timbre={timbre} enabled={live} />
        <LevelSlider x={box.x + R.levelX} y={y + 10} timbre={timbre} enabled={live} />
        <PanRotary x={box.x + R.panX} y={y + 8} timbre={timbre} enabled={live} />
        <OutSelect x={box.x + R.outX} y={y + 8} timbre={timbre} enabled={live} />
      </g>

      {/* A row that cannot sound says so. This is what answers the concern behind the Phase 0
          "order an inverted window" rule that Phase 5 reversed: the cause is now VISIBLE
          rather than being silently corrected. */}
      {silent && (
        <>
          <rect
            x={box.x + 1}
            y={y + 1}
            width={box.w - 2}
            height={R.h - 2}
            rx={4}
            fill={COLORS.bg}
            opacity={0.45}
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={box.x + box.w - 8}
            y={y + R.h - 6}
            fill={COLORS.legendDim}
            fontFamily={FONT_CONDENSED}
            fontSize={8}
            letterSpacing={0.8}
            textAnchor="end"
            style={{ pointerEvents: 'none' }}
          >
            {emptyWindow ? 'WINDOW EMPTY' : off ? 'MUTED' : anySolo ? 'NOT SOLOED' : 'SILENT'}
          </text>
        </>
      )}
    </g>
  );
}

export function TimbreStrip({ box, selected, onSelect }: TimbreStripProps) {
  const type = useCombiType();
  const live = timbresInType(type);
  const R = TIMBRE_ROW;
  const rowH = R.h + R.gap;

  return (
    <g role="group" aria-label="Combination timbres">
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
      {Array.from({ length: TIMBRE_COUNT }, (_, i) => (
        <TimbreRow
          key={i}
          box={{ x: box.x + 6, y: box.y + 6 + i * rowH, w: box.w - 12, h: R.h }}
          timbre={i}
          // Only MULTI exposes all eight rows; the other four types use one or two, and the
          // rest grey out rather than disappearing so the strip does not change shape.
          live={i < live}
          selected={i === selected}
          onSelect={() => onSelect(i)}
        />
      ))}
    </g>
  );
}
