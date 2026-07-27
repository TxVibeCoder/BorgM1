/**
 * UI theme constants — the single source of truth for colors, fonts, and sizing.
 * `src/ui/styles.css` mirrors these values as :root custom properties; change both
 * together or neither (design-agent owned; see CONVENTIONS.md ownership map).
 *
 * Styling policy: dark panels, cream legends, gold-ish knobs —
 * original styling in the spirit of the hardware. NO third-party logos, wordmarks, or
 * trade-dress copies. Plain-text functional titles in our own typography only.
 */

export const COLORS = {
  /** Page background (darker than panels so the rack reads as raised). */
  bg: '#101012',
  /** Panel face. */
  panel: '#1b1b1d',
  /** Raised panel areas (display well, timbre strip). */
  panelRaised: '#232326',
  /** Section outlines, panel border strokes. */
  panelEdge: '#2e2e33',
  /** Drop shadows and recesses. */
  panelShadow: '#0a0a0b',
  /** Primary legend (labels, titles, section names). */
  legend: '#e8e0cf',
  /** Secondary legend (units, min/max ticks, hints). Lifted from #a89f8c so dim captions
   *  clear ~7.5:1 on the panel faces (AAA) instead of sitting at the AA floor. */
  legendDim: '#bcb39d',
  /** Knob body (gold-ish family). */
  knob: '#c89b3c',
  /** Knob top highlight. */
  knobHi: '#e0b95f',
  /** Knob skirt / shaded side. */
  knobLo: '#8a6a24',
  /** Knob pointer line (dark on gold). */
  knobPointer: '#141210',
  ledRed: '#e23b2e',
  /** Lit step-LED hot core — a bright center that adds a brightness/shape cue to the
   *  on-state so it reads without relying on color alone (color-blind / low-vision). */
  ledRedHot: '#ffd9c0',
  ledAmber: '#f0a030',
  ledGreen: '#43b05c',
  /** Unlit LED lens. */
  ledOff: '#473530',
  /** Bright hardware metal — switch bats, screw heads, bezels. */
  metal: '#9aa0a6',
  /** Shaded side of the same metal. */
  metalDark: '#5f6469',
  /** focus-visible outline + drag value readout accent. Intentionally an ALIAS of ledAmber
   *  (#f0a030); kept distinct from the gold active-tab fill (#c89b3c) so the focus ring reads. */
  focus: '#f0a030',
} as const;

/** Body / readout text. System sans only — no webfont dependencies. */
export const FONT_STACK =
  "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
/** Panel legends: condensed where the platform has it, graceful fallback otherwise. */
export const FONT_CONDENSED =
  "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

/**
 * MODE accent colors — hue as a mode signal, the one piece of the reference plugin's
 * language worth copying outright (UI-SPEC §10): lime = editing, blue = browsing.
 * Green marks the selected timbre row in a Combination. Change a color here and every
 * coded surface follows.
 */
export const ACCENT = {
  /** Edit mode — panel highlights, active parameter, the lit tab. */
  edit: '#a8c832',
  /** Browse mode — the program/combi browser modal and everything inside it. */
  browse: '#4f8fd9',
  /** The selected timbre row's edge bar in the 8-row Combination strip. */
  selected: '#43b05c',
} as const;

/** Section-border stroke width (intentionally "thick"). */
export const SECTION_BORDER_WIDTH = 4.5;
/** Borders inset this far from the region seams so adjacent strokes never touch. */
export const SECTION_BORDER_INSET = 3.5;

/** Knob radii in panel viewBox units (s = trimmer-size, m = standard, l = hero CUTOFF). */
export const KNOB_RADIUS = { s: 13, m: 17, l: 22 } as const;

/** Knob rotation sweep: 270°, -135° (min value) to +135° (max value), 0° = straight up. */
export const KNOB_SWEEP_DEG = { start: -135, end: 135 } as const;
/** Vertical relative drag: this many px of pointer travel = one full min→max sweep.
 *  200 (was 150) gives a calmer, more precise coarse drag without changing Shift-fine. */
export const DRAG_FULL_SWEEP_PX = 200;
/** Sensitivity multiplier while Shift is held (fine adjust). */
export const FINE_DRAG_FACTOR = 0.1;

/** LED lens radius in panel viewBox units (step LEDs, button lamps). */
export const LED_RADIUS = 5;
