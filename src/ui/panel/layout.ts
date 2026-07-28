/**
 * Panel layout — UI-SPEC.md's percentage table, as code.
 *
 * Every region is a `pctRect` straight out of UI-SPEC §1 and §3, so transcribing the spec
 * is a copy rather than a conversion (that is what the 1400x800 design box was chosen for:
 * 1% lands on a whole 14 x 8 px).
 *
 * TWO THINGS THIS FILE IS DELIBERATELY NOT:
 *
 *  - It is not a hand-placed coordinate list. 139 parameters hand-positioned is 139 chances
 *    to typo a number, and every one of them would look like a design decision afterwards.
 *    Sections declare WHICH parameters they hold; `flowSections` and `cellAt` compute where.
 *
 *  - It is not two copies of the oscillator layout. Per-oscillator sections list their
 *    parameters WITHOUT the `OSC1_`/`OSC2_` prefix and are rendered by one component
 *    instantiated twice (UI-SPEC §4). The prefix is applied at render time, which is what
 *    makes the two halves structurally unable to drift.
 */

import { pctRect, type RegionBox } from '../stage';

/** UI-SPEC §1: the four horizontal bands. */
export const REGIONS = {
  header: pctRect(0, 0, 100, 13),
  tabs: pctRect(0, 13, 100, 5),
  /** UI-SPEC §3's three work-area columns. */
  left: pctRect(2, 18.5, 36, 63),
  centre: pctRect(39.5, 18.5, 33.5, 63),
  right: pctRect(74, 18.5, 24, 63),
  keyboard: pctRect(0, 82, 100, 18),
} as const;

/** The edit pages. UI-SPEC §5: `EASY` is a curated subset, not a section. */
export const PAGES = ['EASY', 'OSC', 'FILTER', 'AMP', 'CONTROL'] as const;
export type PageId = (typeof PAGES)[number];

export interface ParamSection {
  title: string;
  /**
   * Parameter ids. For `perOsc` sections these omit the `OSC1_`/`OSC2_` prefix — the
   * oscillator component supplies it.
   */
  params: string[];
  /** Rendered once per oscillator, with the `2` copy greyed in SINGLE mode. */
  perOsc?: boolean;
  /**
   * Program-level parameters that nonetheless only DO anything in DOUBLE mode, so they grey
   * with oscillator 2 despite not being per-oscillator: INTERVAL, DETUNE and DELAY START
   * are all defined relative to oscillator 1 and reach only oscillator 2.
   */
  oscTwoOnly?: boolean;
  /** Override the computed column count (for a section that reads better in one row). */
  columns?: number;
}

export interface PageLayout {
  left: ParamSection[];
  centre: ParamSection[];
  /** The right column is the two EG graphs on every page except CONTROL. */
  right: 'egs' | ParamSection[];
}

/** Voice-structure parameters that are not per-oscillator. */
const OSC_BASIC: ParamSection = {
  title: 'VOICE',
  params: ['OSC_MODE', 'ASSIGN', 'HOLD'],
};

/** Oscillator 2's relationship to oscillator 1. Meaningless in SINGLE, so it greys with it. */
const OSC_PAIR: ParamSection = {
  title: 'OSC 2 OFFSET',
  params: ['INTERVAL', 'DETUNE', 'DELAY_START'],
  oscTwoOnly: true,
};

const PITCH_EG: ParamSection = {
  title: 'PITCH EG',
  perOsc: true,
  params: [
    'PEG_START', 'PEG_AT', 'PEG_AL', 'PEG_DT',
    'PEG_RT', 'PEG_RL', 'PEG_TIME_VEL', 'PEG_LEVEL_VEL',
  ],
};

const FILTER_MAIN: ParamSection = {
  title: 'FILTER',
  perOsc: true,
  params: ['VDF_CUTOFF', 'VDF_EG_INT'],
};

const FILTER_EG: ParamSection = {
  title: 'FILTER EG',
  perOsc: true,
  params: [
    'VDF_EG_AT', 'VDF_EG_AL', 'VDF_EG_DT', 'VDF_EG_BP',
    'VDF_EG_ST', 'VDF_EG_SL', 'VDF_EG_RT', 'VDF_EG_RL',
  ],
};

const FILTER_TRACK: ParamSection = {
  title: 'FILTER KBD TRACK',
  perOsc: true,
  params: [
    'VDF_TRACK_CENTER', 'VDF_CUTOFF_TRACK', 'VDF_EGT_TRACK',
    'VDF_EGT_TRACK_ATTACK', 'VDF_EGT_TRACK_DECAY',
    'VDF_EGT_TRACK_SLOPE', 'VDF_EGT_TRACK_RELEASE',
  ],
};

const FILTER_VEL: ParamSection = {
  title: 'FILTER VELOCITY',
  perOsc: true,
  params: [
    'VDF_EGI_VEL', 'VDF_EGT_VEL',
    'VDF_EGT_VEL_ATTACK', 'VDF_EGT_VEL_DECAY',
    'VDF_EGT_VEL_SLOPE', 'VDF_EGT_VEL_RELEASE',
  ],
};

const AMP_MAIN: ParamSection = {
  title: 'AMP',
  perOsc: true,
  params: ['VDA_LEVEL'],
};

const AMP_EG: ParamSection = {
  title: 'AMP EG',
  perOsc: true,
  params: [
    'VDA_EG_AT', 'VDA_EG_AL', 'VDA_EG_DT', 'VDA_EG_BP',
    'VDA_EG_ST', 'VDA_EG_SL', 'VDA_EG_RT',
  ],
};

const AMP_TRACK: ParamSection = {
  title: 'AMP KBD TRACK',
  perOsc: true,
  params: [
    'VDA_TRACK_CENTER', 'VDA_AMP_TRACK', 'VDA_EGT_TRACK',
    'VDA_EGT_TRACK_ATTACK', 'VDA_EGT_TRACK_DECAY',
    'VDA_EGT_TRACK_SLOPE', 'VDA_EGT_TRACK_RELEASE',
  ],
};

const AMP_VEL: ParamSection = {
  title: 'AMP VELOCITY',
  perOsc: true,
  params: [
    'VDA_AMP_VEL', 'VDA_EGT_VEL',
    'VDA_EGT_VEL_ATTACK', 'VDA_EGT_VEL_DECAY',
    'VDA_EGT_VEL_SLOPE', 'VDA_EGT_VEL_RELEASE',
  ],
};

const PITCH_MG: ParamSection = {
  title: 'PITCH MG',
  params: [
    'PMG_WAVE', 'PMG_FREQ', 'PMG_DELAY', 'PMG_INTENSITY',
    'PMG_OSC1_ENABLE', 'PMG_OSC2_ENABLE', 'PMG_KEY_SYNC',
  ],
};

const FILTER_MG: ParamSection = {
  title: 'FILTER MG',
  params: [
    'FMG_WAVE', 'FMG_FREQ', 'FMG_DELAY', 'FMG_INTENSITY',
    'FMG_OSC1_ENABLE', 'FMG_OSC2_ENABLE', 'FMG_KEY_SYNC',
  ],
};

const AFTER_TOUCH: ParamSection = {
  title: 'AFTER TOUCH',
  params: ['AT_PITCH', 'AT_PITCH_MG', 'AT_VDF_CUTOFF', 'AT_VDF_MG', 'AT_VDA_AMP'],
};

const JOY_STICK: ParamSection = {
  title: 'JOY STICK',
  params: [
    'JS_PITCH_BEND', 'JS_VDF_SWEEP',
    'JS_PITCH_MG_INT', 'JS_PITCH_MG_FREQ',
    'JS_VDF_MG_INT', 'JS_VDF_MG_FREQ',
  ],
};

/** The EASY page's curated subset — the handful you reach for first, and nothing else. */
const EASY_OSC: ParamSection = {
  title: 'OSC',
  perOsc: true,
  params: ['MULTISOUND', 'OCTAVE', 'VDA_LEVEL'],
};

const EASY_TONE: ParamSection = {
  title: 'TONE',
  perOsc: true,
  params: ['VDF_CUTOFF', 'VDF_EG_INT', 'VDA_AMP_VEL'],
};

const EASY_ENV: ParamSection = {
  title: 'AMP ENVELOPE',
  perOsc: true,
  params: ['VDA_EG_AT', 'VDA_EG_DT', 'VDA_EG_SL', 'VDA_EG_RT'],
};

/** Full per-oscillator sound source, for the OSC deep-edit page. */
const OSC_SOURCE: ParamSection = {
  title: 'OSC',
  perOsc: true,
  params: ['MULTISOUND', 'OCTAVE', 'VDA_LEVEL'],
};

export const PAGE_LAYOUTS: Record<PageId, PageLayout> = {
  // UI-SPEC §5: EASY shows OSC, FILTER and both EG graphs at once. It is the page that
  // makes a 143-parameter instrument approachable, so it holds a subset, not a summary.
  EASY: { left: [OSC_BASIC, EASY_OSC], centre: [EASY_TONE, EASY_ENV], right: 'egs' },
  OSC: { left: [OSC_BASIC, OSC_PAIR], centre: [OSC_SOURCE, PITCH_EG], right: 'egs' },
  // The filter EG gets a numeric section as well as the graph. The graph's handles edit the
  // same eight bytes, but a handle is a coarse instrument and some of these want typing-in
  // accuracy — and "editable" should not mean "only by dragging a 7 px square".
  FILTER: { left: [FILTER_MAIN, FILTER_EG], centre: [FILTER_TRACK, FILTER_VEL], right: 'egs' },
  AMP: { left: [AMP_MAIN, AMP_EG], centre: [AMP_TRACK, AMP_VEL], right: 'egs' },
  CONTROL: { left: [PITCH_MG, AFTER_TOUCH], centre: [JOY_STICK, FILTER_MG], right: 'egs' },
};

// ---- geometry ---------------------------------------------------------------------------

/** One control's cell. Sized for a medium knob plus its label and value readout. */
export const CELL = { w: 64, h: 66 } as const;
/** Padding inside a section box, and the height its title bar occupies. */
export const SECTION_PAD = 10;
export const SECTION_TITLE_H = 20;
/** Gap between stacked sections in a column. */
export const SECTION_GAP = 8;
/** A per-oscillator section renders two oscillator sub-blocks; this labels each. */
export const OSC_LABEL_W = 22;

/** How many cells fit across a section of this width. */
export function columnsFor(width: number, override?: number): number {
  if (override) return override;
  return Math.max(1, Math.floor((width - 2 * SECTION_PAD - OSC_LABEL_W) / CELL.w));
}

/** Centre of cell `i` inside a section whose content box starts at (x, y). */
export function cellAt(i: number, cols: number, x: number, y: number): { x: number; y: number } {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: x + col * CELL.w + CELL.w / 2, y: y + row * CELL.h + CELL.h / 2 };
}

export function rowsFor(count: number, cols: number): number {
  return Math.max(1, Math.ceil(count / cols));
}

/**
 * Height a section needs. A per-oscillator section is rendered TWICE inside one box (one
 * sub-block per oscillator), which is why its grid height is doubled rather than the section
 * being listed twice.
 */
export function sectionHeight(section: ParamSection, width: number): number {
  const cols = columnsFor(width, section.columns);
  const rows = rowsFor(section.params.length, cols);
  const blocks = section.perOsc ? 2 : 1;
  return SECTION_TITLE_H + rows * CELL.h * blocks + SECTION_PAD;
}

/**
 * Stack sections down a column, giving each the height it asked for and distributing any
 * slack evenly. Returns a box per section, in order.
 */
export function flowSections(sections: ParamSection[], region: RegionBox): RegionBox[] {
  if (sections.length === 0) return [];
  const heights = sections.map((s) => sectionHeight(s, region.w));
  const total = heights.reduce((a, b) => a + b, 0) + SECTION_GAP * (sections.length - 1);
  const slack = Math.max(0, region.h - total) / sections.length;

  const out: RegionBox[] = [];
  let y = region.y;
  for (let i = 0; i < sections.length; i++) {
    const h = heights[i]! + slack;
    out.push({ x: region.x, y, w: region.w, h });
    y += h + SECTION_GAP;
  }
  return out;
}

/** Fully-qualified id for a parameter inside a section, given the oscillator it renders for. */
export function paramIdFor(section: ParamSection, param: string, osc: 1 | 2): string {
  return section.perOsc ? `OSC${osc}_${param}` : param;
}
