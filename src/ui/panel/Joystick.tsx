/**
 * The joystick and the aftertouch strip — the two performance controllers the program's
 * bytes 27..37 assign depths to.
 *
 * These exist in Phase 3 for a specific reason: the JOY STICK and AFTER TOUCH parameters are
 * DEPTHS, not sounds. Without something to move, "turning any control changes the sound"
 * would be false for eleven of the 139 parameters — they would be editable and inaudible.
 *
 * THE AXES (UI-SPEC §6 puts the stick in an oval recess at the left of the keybed):
 *   X       pitch bend, both directions, spring-centred.
 *   Y up    PITCH MG intensity and frequency, plus the FILTER SWEEP depth.
 *   Y down  FILTER MG intensity and frequency.
 * Splitting the Y axis that way is Korg's arrangement and is why bytes 33..37 come in an
 * up-half/down-half pair. Springs return X and Y to centre on release, as the hardware does.
 */

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { engineBridge } from '../../engine/engineBridge';
import type { RegionBox } from '../stage';
import { ACCENT, COLORS, FONT_CONDENSED } from '../theme';

const KNOB_R = 13;

export function Joystick({ box }: { box: RegionBox }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [aftertouch, setAftertouch] = useState(0);
  const ref = useRef<SVGRectElement | null>(null);

  // The box has to hold FOUR stacked things — label, pad, AFTER TOUCH label, slider — so
  // the pad is sized from the height MINUS the other three, not from the raw box. Sizing it
  // `min(w,h) − 12` left the pad covering its own label and pushed the slider off the
  // bottom of the wheels SVG entirely.
  const labelBandH = 14;
  const atBandH = 30;
  const size = Math.min(box.w - 24, box.h - labelBandH - atBandH - 4);
  const cx = box.x + box.w / 2;
  const padTop = box.y + labelBandH;
  const cy = padTop + size / 2;
  const half = size / 2 - KNOB_R;

  const move = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // Normalize against the rendered size, so the stage's uniform scale cancels out.
      const nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, 1 - ((e.clientY - rect.top) / rect.height) * 2));
      setPos({ x: nx, y: ny });
      engineBridge.setJoystick(nx, ny);
    },
    [],
  );

  const release = useCallback((e: ReactPointerEvent<SVGRectElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Spring back to centre. A stick left off-centre would leave every note bent, which is
    // the kind of "the synth is broken" symptom that points nowhere near its cause.
    setPos({ x: 0, y: 0 });
    engineBridge.setJoystick(0, 0);
  }, []);

  return (
    <g>
      <text
        x={cx}
        y={box.y + 9}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={9}
        letterSpacing={1.4}
        textAnchor="middle"
      >
        JOY STICK
      </text>
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        rx={size / 2}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
        strokeWidth={2}
      />
      <line x1={cx - half} y1={cy} x2={cx + half} y2={cy} stroke={COLORS.panelEdge} strokeWidth={1} />
      <line x1={cx} y1={cy - half} x2={cx} y2={cy + half} stroke={COLORS.panelEdge} strokeWidth={1} />
      <circle
        cx={cx + pos.x * half}
        cy={cy - pos.y * half}
        r={KNOB_R}
        fill={COLORS.knob}
        stroke={COLORS.knobLo}
        strokeWidth={2}
        pointerEvents="none"
      />
      <rect
        ref={ref}
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        fill="transparent"
        style={{ cursor: 'grab', touchAction: 'none' }}
        role="application"
        aria-label="Joystick: horizontal bends pitch, vertical drives modulation"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      />

      {/* AFTER TOUCH. The on-screen keybed cannot report pressure, so it gets its own slider
          — otherwise the five AFTER TOUCH depths are editable and permanently silent. */}
      <text
        x={cx}
        y={padTop + size + 12}
        fill={COLORS.legendDim}
        fontFamily={FONT_CONDENSED}
        fontSize={9}
        letterSpacing={1.4}
        textAnchor="middle"
      >
        AFTER TOUCH
      </text>
      <rect
        x={cx - size / 2}
        y={padTop + size + 17}
        width={size}
        height={10}
        rx={5}
        fill={COLORS.panelShadow}
        stroke={COLORS.panelEdge}
      />
      <rect
        x={cx - size / 2}
        y={padTop + size + 17}
        width={size * aftertouch}
        height={10}
        rx={5}
        fill={ACCENT.edit}
        pointerEvents="none"
      />
      <rect
        x={cx - size / 2}
        y={padTop + size + 13}
        width={size}
        height={18}
        fill="transparent"
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
        role="slider"
        aria-label="Aftertouch pressure"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(aftertouch * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          const v = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setAftertouch(v);
          engineBridge.setAftertouch(v);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const v = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setAftertouch(v);
          engineBridge.setAftertouch(v);
        }}
        onPointerUp={() => {
          setAftertouch(0);
          engineBridge.setAftertouch(0);
        }}
      />
    </g>
  );
}
