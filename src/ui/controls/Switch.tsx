/**
 * Vertical lever switch (2 or 3 positions) — renders from def.positions, index 0
 * at the top. Click advances and wraps (Shift-click goes backward, CONVENTIONS.md);
 * Space/Enter does the same. Discrete change: onChange(pos) -> engine write +
 * store commit together, no debounce.
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { SwitchProps } from '../types';
import { COLORS, FONT_CONDENSED } from '../theme';

/** Vertical distance between adjacent lever notches (panel viewBox units). */
const NOTCH_SPACING = 16;
const SLOT_W = 10;

/**
 * The whole control is shifted DOWN by this much within its cell.
 *
 * The switch is the one control whose label sits ABOVE it, so centring the slot on the cell
 * centre pushed the label ~10px past the cell top — where it landed on the section title
 * (row 1) or on the label of the knob in the row above (wrapped rows: the KBD TRACK
 * sections' RELEASE switch printing over CENTER KEY). Shifting the group down puts the
 * label + slot INSIDE the 66px cell for 2- and 3-position switches; the two 4-position
 * waveform switches overflow 3px above and are kept out of column 0 by layout.ts so they
 * cannot reach the title.
 */
const DY = 10;

export function Switch({ def, value, onChange, x, y }: SwitchProps) {
  const positions = def.positions ?? [];
  const count = positions.length;
  const idx = Math.max(0, positions.indexOf(value));
  // Lever, ticks and caption all paint at `idx`; derive the announced label from the SAME
  // resolved position so an unknown/stale `value` can't make the aria-label disagree with the
  // visible lever (B5). Falls back to the raw value only in the degenerate empty-positions case.
  const shownPos = positions[idx] ?? value;
  const yOf = (i: number) => DY + (i - (count - 1) / 2) * NOTCH_SPACING;
  const slotH = Math.max(count - 1, 1) * NOTCH_SPACING + 14;

  const advance = (dir: 1 | -1) => {
    if (count < 2) return;
    const next = positions[(idx + dir + count) % count];
    if (next != null && next !== value) onChange(next);
  };

  const onClick = (e: ReactMouseEvent<SVGGElement>) => advance(e.shiftKey ? -1 : 1);

  const onKeyDown = (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      advance(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      advance(e.shiftKey ? -1 : 1);
    }
  };

  return (
    <g
      className="control"
      transform={`translate(${x} ${y})`}
      tabIndex={0}
      role="button"
      aria-label={`${def.panelLabel}: ${shownPos}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {/* transparent hit area — the visible parts (a thin 10px slot + glyph-only
          captions) leave large gaps, so a centered click can fall on transparent
          space and pass through to whatever paints behind. This invisible rect
          spans the full control footprint (label above → slot bottom, slot →
          captions) so the whole control is a reliable click/hit target. Painted
          first so it sits behind the visuals; fill carries the hit. */}
      <rect
        x={-34}
        y={DY - slotH / 2 - 20}
        width={84}
        height={slotH + 28}
        fill="transparent"
      />

      {/* label above — width-clamped so a long legend cannot invade the neighbouring cell */}
      <text
        y={DY - slotH / 2 - 6}
        textAnchor="middle"
        fontFamily={FONT_CONDENSED}
        fontSize={11}
        letterSpacing={0.5}
        fill={COLORS.legend}
        {...(def.panelLabel.length * 6.0 > 62
          ? { textLength: 62, lengthAdjust: 'spacingAndGlyphs' as const }
          : {})}
      >
        {def.panelLabel.toUpperCase()}
      </text>

      {/* recessed slot */}
      <rect
        x={-SLOT_W / 2}
        y={DY - slotH / 2}
        width={SLOT_W}
        height={slotH}
        rx={SLOT_W / 2}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
        strokeWidth={1}
      />

      {/* lever paddle at the active notch */}
      <rect
        x={-8}
        y={yOf(idx) - 6}
        width={16}
        height={12}
        rx={3}
        fill={COLORS.metal}
        stroke={COLORS.metalDark}
        strokeWidth={1}
      />
      <line x1={-5} x2={5} y1={yOf(idx)} y2={yOf(idx)} stroke={COLORS.metalDark} strokeWidth={1} />

      {/* position captions beside the lever; active one bright. Clamped to 36
          units so long position names ("FREQUENCY") can't invade the neighbor. */}
      {positions.map((pos, i) => (
        <text
          key={pos}
          x={13}
          y={yOf(i) + 3}
          fontFamily={FONT_CONDENSED}
          fontSize={11}
          letterSpacing={0.3}
          fill={i === idx ? COLORS.legend : COLORS.legendDim}
          {...(pos.length * 5.8 > 32 ? { textLength: 32, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
        >
          {pos.toUpperCase()}
        </text>
      ))}
    </g>
  );
}
