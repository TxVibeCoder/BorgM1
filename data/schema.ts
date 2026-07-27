/**
 * Control definition schema.
 *
 * Inherited from SynthStack minus everything patchbay: the jack definition, its
 * control-voltage range annotation, the signal/direction vocabularies and the normalled-
 * connection referential-integrity pass are all gone — the M1 has no patchbay and no
 * cables, so a control is the only thing this file has to describe.
 *
 * Phase 3 authors the real parameter model straight from the 143-byte SysEx table
 * and validates it against this, the way SynthStack's moduleData.test.ts did.
 */

export type Taper = 'lin' | 'exp' | 'stepped';

export interface ControlDef {
  id: string; // 'VDF_CUTOFF'
  panelLabel: string; // 'CUTOFF'
  type: 'knob' | 'switch' | 'button' | 'stepKnob';
  // knobs:
  min?: number;
  max?: number;
  default?: number | string;
  taper?: Taper;
  steps?: number; // stepped knobs
  unit?: string; // 'Hz' | 's' | '%' | 'dB' | 'semi' ...
  // switches/buttons:
  positions?: string[]; // ['SINGLE','DOUBLE','DRUMS'], ['OFF','ON'] ...
  manualRef?: string; // "Owner's Manual p.44"
  notes?: string;
}

const TAPERS: Taper[] = ['lin', 'exp', 'stepped'];
const CONTROL_TYPES = ['knob', 'switch', 'button', 'stepKnob'];

/** Returns a list of human-readable validation errors (empty = valid). */
export function validateControlDefs(scope: string, controls: ControlDef[]): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`[${scope}] ${msg}`);

  const controlIds = new Set<string>();
  for (const c of controls) {
    if (controlIds.has(c.id)) err(`duplicate control id ${c.id}`);
    controlIds.add(c.id);
    if (!CONTROL_TYPES.includes(c.type)) err(`${c.id}: bad control type ${c.type}`);
    if (!c.panelLabel) err(`${c.id}: missing panelLabel`);
    if (c.type === 'knob' || c.type === 'stepKnob') {
      if (typeof c.min !== 'number' || typeof c.max !== 'number') {
        err(`${c.id}: knob needs numeric min/max`);
      } else {
        if (!(c.min < c.max)) err(`${c.id}: min (${c.min}) must be < max (${c.max})`);
        if (typeof c.default !== 'number') err(`${c.id}: knob needs numeric default`);
        else if (c.default < c.min || c.default > c.max) {
          err(`${c.id}: default ${c.default} out of range [${c.min}, ${c.max}]`);
        }
      }
      if (c.taper !== undefined && !TAPERS.includes(c.taper)) err(`${c.id}: bad taper ${c.taper}`);
      if (c.steps !== undefined && (!Number.isInteger(c.steps) || c.steps < 2)) {
        err(`${c.id}: steps must be an integer >= 2`);
      }
    }
    if (c.type === 'switch') {
      if (!c.positions || c.positions.length < 2) err(`${c.id}: switch needs >= 2 positions`);
      else if (typeof c.default === 'string' && !c.positions.includes(c.default)) {
        err(`${c.id}: default '${c.default}' not in positions`);
      }
    }
    if (c.type === 'button' && c.positions && typeof c.default === 'string') {
      if (!c.positions.includes(c.default)) err(`${c.id}: default '${c.default}' not in positions`);
    }
  }

  return errors;
}
