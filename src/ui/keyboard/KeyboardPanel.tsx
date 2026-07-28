/**
 * On-screen keybed. SVG, laid out from the shared keyMap geometry so the panel and the
 * engine agree on which key is which note — defined once, never duplicated.
 *
 * Pointer capture on the whole bed rather than per key, so a drag glissandos across keys
 * the way a real keyboard does instead of stopping at the one that was pressed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { KEYBED_SHAPE, keyToNote } from '../../engine/voice/keyMap';
import { COLORS } from '../theme';

const WHITE_W = 24;
const WHITE_H = 130;
const BLACK_W = 14;
const BLACK_H = 82;

const WHITE_KEYS = KEYBED_SHAPE.filter((k) => !k.isBlack);
export const KEYBED_W = WHITE_KEYS.length * WHITE_W;
export const KEYBED_H = WHITE_H;

/** x position of a key, derived from how many white keys precede it. */
function keyX(semitone: number): number {
  let whites = 0;
  for (const k of KEYBED_SHAPE) {
    if (k.semitone >= semitone) break;
    if (!k.isBlack) whites++;
  }
  const shape = KEYBED_SHAPE[semitone]!;
  return shape.isBlack ? whites * WHITE_W - BLACK_W / 2 : whites * WHITE_W;
}

export interface KeyboardPanelProps {
  octave: number;
  held: ReadonlySet<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
}

export function KeyboardPanel({ octave, held, onNoteOn, onNoteOff }: KeyboardPanelProps) {
  const [dragging, setDragging] = useState(false);
  /** The note the pointer is currently sounding, so a glissando releases as it moves. */
  const current = useRef<number | null>(null);

  const noteAt = useCallback(
    (clientX: number, clientY: number, svg: SVGSVGElement): number | null => {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * KEYBED_W;
      const y = ((clientY - r.top) / r.height) * KEYBED_H;
      // Black keys first: they overlap the whites and sit on top.
      for (const k of KEYBED_SHAPE) {
        if (!k.isBlack) continue;
        const kx = keyX(k.semitone);
        if (x >= kx && x < kx + BLACK_W && y < BLACK_H) return keyToNote(k.semitone, 0);
      }
      for (const k of KEYBED_SHAPE) {
        if (k.isBlack) continue;
        const kx = keyX(k.semitone);
        if (x >= kx && x < kx + WHITE_W) return keyToNote(k.semitone, 0);
      }
      return null;
    },
    [],
  );

  const press = useCallback(
    (note: number | null) => {
      if (note === current.current) return;
      if (current.current !== null) onNoteOff(current.current + octave * 12);
      current.current = note;
      if (note !== null) onNoteOn(note + octave * 12, 100);
    },
    [octave, onNoteOff, onNoteOn],
  );

  // Release on pointer-up ANYWHERE, not just over the keybed: releasing outside the SVG
  // otherwise leaves the note sounding with no way to stop it.
  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      press(null);
      setDragging(false);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, press]);

  const isHeld = (semitone: number) => held.has(keyToNote(semitone, 0) + octave * 12);

  return (
    <svg
      className="panel keybed"
      viewBox={`0 0 ${KEYBED_W} ${KEYBED_H}`}
      data-testid="keybed"
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        press(noteAt(e.clientX, e.clientY, e.currentTarget));
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        press(noteAt(e.clientX, e.clientY, e.currentTarget));
      }}
    >
      {KEYBED_SHAPE.filter((k) => !k.isBlack).map((k) => (
        <rect
          key={k.semitone}
          className="control"
          x={keyX(k.semitone)}
          y={0}
          width={WHITE_W - 1}
          height={WHITE_H}
          rx={2}
          fill={isHeld(k.semitone) ? COLORS.knob : '#e8e6e0'}
          stroke={COLORS.panelShadow}
          strokeWidth={1}
        />
      ))}
      {KEYBED_SHAPE.filter((k) => k.isBlack).map((k) => (
        <rect
          key={k.semitone}
          className="control"
          x={keyX(k.semitone)}
          y={0}
          width={BLACK_W}
          height={BLACK_H}
          rx={2}
          fill={isHeld(k.semitone) ? COLORS.knobLo : '#17171a'}
          stroke={COLORS.panelShadow}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
