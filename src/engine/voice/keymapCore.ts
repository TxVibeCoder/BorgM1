/**
 * Key/velocity -> sample lookup — PURE, no Web Audio types, Node-testable.
 *
 * A 128 x 128 `Uint16Array` per oscillator: 16,384 entries, 32 KB. Built once when a
 * program's oscillator changes, then read with a single index per note-on and no branches
 * at all. Zone lists would need a loop with two comparisons per zone on the hot path; a
 * table turns that into one multiply-add.
 *
 * THE VELOCITY AXIS IS PRESENT BUT CONSTANT for a multisound, and that is correct rather
 * than wasteful: a multisound has NO velocity zones — architecturally, not by omission.
 * Velocity switching lives at Program level (DOUBLE with opposite-signed amp sensitivities
 * gives a continuous crossfade) and at Combination level (a hard VELOCITY SW split). The
 * axis exists so those two layers, and drum kits, use the same lookup rather than a
 * parallel one.
 */

/** Table entry meaning "nothing sounds here". */
export const NO_SAMPLE = 0xffff;

export const KEYS = 128;
export const VELOCITIES = 128;
export const KEYMAP_ENTRIES = KEYS * VELOCITIES;

export interface KeyZoneSpec {
  keyLow: number;
  keyHigh: number;
  /** Index into the program's sample table. Must be < NO_SAMPLE. */
  sampleIndex: number;
  /** Optional velocity window; defaults to the whole range. */
  velLow?: number;
  velHigh?: number;
}

/**
 * Build the lookup table.
 *
 * Later zones win where they overlap, which matches how the bank's zones are authored
 * (contiguous runs, no intentional overlap) and gives a deterministic answer if they ever
 * are not.
 */
export function buildKeymap(zones: readonly KeyZoneSpec[]): Uint16Array {
  const table = new Uint16Array(KEYMAP_ENTRIES).fill(NO_SAMPLE);
  for (const z of zones) {
    const kLo = Math.max(0, Math.min(KEYS - 1, z.keyLow));
    const kHi = Math.max(0, Math.min(KEYS - 1, z.keyHigh));
    const vLo = Math.max(0, Math.min(VELOCITIES - 1, z.velLow ?? 0));
    const vHi = Math.max(0, Math.min(VELOCITIES - 1, z.velHigh ?? VELOCITIES - 1));
    if (kHi < kLo || vHi < vLo) continue;
    const idx = z.sampleIndex >= NO_SAMPLE ? NO_SAMPLE : z.sampleIndex;
    for (let k = kLo; k <= kHi; k++) {
      const row = k * VELOCITIES;
      for (let v = vLo; v <= vHi; v++) table[row + v] = idx;
    }
  }
  return table;
}

/**
 * Look up a sample index. Branch-free on the hot path.
 *
 * Callers must pass an in-range key and velocity; MIDI guarantees both. The `& 127` is
 * cheap insurance against a transposed key running off the end, which would otherwise read
 * out of bounds and return undefined into a multiply.
 */
export function lookup(table: Uint16Array, key: number, velocity: number): number {
  return table[((key & 127) << 7) | (velocity & 127)]!;
}

/** A key sounds somewhere in its velocity range. */
export function keySounds(table: Uint16Array, key: number): boolean {
  const row = (key & 127) << 7;
  for (let v = 0; v < VELOCITIES; v++) if (table[row + v] !== NO_SAMPLE) return true;
  return false;
}

/**
 * Lowest and highest sounding key, or [-1, -1] if silent.
 *
 * Multisounds genuinely do not all span 0..127, and that is authentic: the Owner's Manual
 * states that each waveform has a limited pitch range and "may not sound when played in a
 * high octave". The engine needs the range so it can go silent exactly where the hardware
 * does, rather than pitching the top zone into the ultrasonic.
 */
export function keyRange(table: Uint16Array): [number, number] {
  let lo = -1;
  let hi = -1;
  for (let k = 0; k < KEYS; k++) {
    if (keySounds(table, k)) {
      if (lo === -1) lo = k;
      hi = k;
    }
  }
  return [lo, hi];
}
