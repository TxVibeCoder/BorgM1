/**
 * UI type contracts (design-agent owned — see CONVENTIONS.md).
 * All x/y/w/h coordinates are SVG viewBox units inside the owning panel's viewBox.
 * Every panel viewBox maps 1:1 to stage px (src/ui/stage.ts, a 7:4 design box).
 * Coordinates locate element CENTERS for controls and LEDs, and the top-left
 * corner for sections.
 */

import type { ControlDef } from '../../data/schema';

export interface Pt {
  x: number;
  y: number;
}

export type KnobSize = 's' | 'm' | 'l';

/** A silkscreen section box (e.g. "OSCILLATOR", "FILTER") with its label. */
export interface PanelSection {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-panel layout, keyed by ControlDef id. Panel components iterate this — never
 * hard-code positions inline.
 *
 * The `1`/`2` rule (UI-SPEC §4): every per-oscillator control appears twice, so one
 * layout is instantiated against both halves of the parameter model and the `2` copy
 * greys out in SINGLE mode. `enabled` is the single flag that drives it.
 */
export interface PanelLayout {
  /** Panel viewBox width = its stage region width (src/ui/stage.ts). */
  width: number;
  /** Panel viewBox height = its stage region height. */
  height: number;
  /** Plain-text functional title — no trade dress. */
  title: string;
  sections: PanelSection[];
  /** controlId -> position, optional knob size (default 'm') and label placement. */
  controls: Record<string, Pt & { size?: KnobSize; labelBelow?: boolean }>;
}

/**
 * Knob (and stepKnob). Value lives in ControlDef [min, max] space; the engine's
 * parameter adapter applies the taper — not the UI.
 */
export interface KnobProps {
  def: ControlDef;
  value: number;
  /**
   * Fires continuously during drag → IMMEDIATE imperative engine write via the
   * bridge. Must NOT write the store or trigger React renders outside this knob.
   */
  onInput: (v: number) => void;
  /** Fires once on pointer release / double-click reset → single store commit. */
  onCommit: (v: number) => void;
  size?: KnobSize;
  /** Optional accent color for the knob skirt — per-section color coding. */
  accent?: string;
  /** Optional dim second line under the panel label (e.g. a live readout). */
  subLabel?: string;
  x: number;
  y: number;

  // ---- long-press assign gesture (optional; all knobs ignore these when unset) ----------
  // Inherited from SynthStack's Knob, where it drove mod-source assignment. Retained
  // because the gesture (hold to arm, then drag any target to set a bipolar depth) is
  // the cheapest way to expose EG Intensity / keyboard-tracking depths without another
  // page. Unused until a phase wires it; every field is optional.
  /** Fired on a ~450 ms hold, cancelled on >4 px travel. */
  onLongPress?: () => void;
  /**
   * Drives the assign-mode overlay AND the drag sink:
   *   - 'source-armed': this knob is the armed source (paints the focus ring).
   *   - 'depth-target': a source is armed and this is a supported target — a normal
   *     vertical drag scrubs the bipolar depth via onAssignDepthInput/Commit instead
   *     of the knob's own value, which is left untouched.
   *   - 'idle' / unset: ordinary knob behaviour.
   */
  assignMode?: 'idle' | 'source-armed' | 'depth-target';
  /** Current assigned depth (-1..1) for THIS knob's route; drives the depth arc. */
  assignDepth?: number;
  /** Short source tag — distinguishes multiple sources on one knob. */
  assignTag?: string;
  /** Color of the source ring / depth-arc accent (the armed source's color). */
  assignColor?: string;
  /** While in 'depth-target': fires continuously during the scrub (local-only). */
  onAssignDepthInput?: (depth: number) => void;
  /** While in 'depth-target': fires once on release with the final depth. */
  onAssignDepthCommit?: (depth: number) => void;
}

export interface SwitchProps {
  def: ControlDef;
  /** Current position — one of def.positions. */
  value: string;
  /** New position → engine write + store commit (discrete; no debounce). */
  onChange: (pos: string) => void;
  x: number;
  y: number;
}

export interface ButtonProps extends SwitchProps {
  /** Drives the button's LED lamp. */
  lit?: boolean;
  /**
   * Momentary buttons (e.g. HOLD): onChange(active pos) on pointerdown,
   * onChange(idle pos) on pointerup/pointercancel. Latching otherwise.
   */
  momentary?: boolean;
}

/** Step LED. `dim` = visible-but-not-current ghosting. */
export interface StepLedProps {
  x: number;
  y: number;
  on: boolean;
  dim?: boolean;
}
