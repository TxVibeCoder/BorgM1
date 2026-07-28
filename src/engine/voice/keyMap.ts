/**
 * Keybed geometry + note mapping — PURE, Web-Audio-free and React-free, Node-testable.
 * Shared by the engine bridge AND the on-screen keyboard so the white/black layout and
 * the semitone -> MIDI-note mapping are defined ONCE and never duplicated.
 *
 * The on-screen keybed is the FULL 88-KEY PIANO, A0-C8 — UI-SPEC §6, which measured the
 * reference plugin's bed at exactly that (52 white + 36 black). Semitone 0 (the low A) is
 * MIDI note 21 at octaveShift 0, so middle C (60) sits at semitone 39. The 88-key span is
 * also what makes the bed FIT its band: 52 white keys give the SVG a ~9.6:1 aspect ratio,
 * which fills the keyboard band's width at less than its height — the previous 25-key bed's
 * 2.8:1 ratio made a width-fitted SVG three times taller than the band, and it climbed up
 * over the panel.
 *
 * DOUBLE-SHIFT RESOLUTION (design-locked): the octave transpose lives in EXACTLY ONE
 * place — the bridge. The panel ALWAYS calls keyToNote(semitone, 0) and gets an
 * octave-free raw note; keyToNote keeps its octaveShift parameter purely for unit tests
 * (semitone 39 @ shift 0 -> 60; +1 shift -> +12). Applying it in both places is how an
 * on-screen keyboard ends up two octaves off its own MIDI input.
 */

/** Total keys in the on-screen bed: the full piano, A0..C8. */
export const KEYBED_KEYS = 88;

/** MIDI note of semitone 0 (the low A) at octaveShift 0 = A0. Middle C (60) is semitone 39. */
export const KEYBED_LOW_NOTE = 21;

/** One key in the bed: its semitone offset (0..87 from the low A) and whether it is black. */
export interface KeyShape {
  /** 0..87, semitones above the low A. */
  semitone: number;
  /** true for the 5 sharps per octave (after C, D, F, G, A); false for the 7 naturals. */
  isBlack: boolean;
}

/** Black PITCH CLASSES: C#, D#, F#, G#, A# (1,3,6,8,10 above C); none after E or B. */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** Fixed 88-entry white/black layout. Blackness comes from the PITCH CLASS of the actual
 *  MIDI note, not from `semitone % 12` — the bed starts on A, not C. */
export const KEYBED_SHAPE: KeyShape[] = Array.from({ length: KEYBED_KEYS }, (_, semitone) => ({
  semitone,
  isBlack: BLACK_PITCH_CLASSES.has((KEYBED_LOW_NOTE + semitone) % 12),
}));

/**
 * Map a key's semitone offset (0..87) + an octave shift to a raw MIDI note number:
 *   21 + 12·octaveShift + semitoneOffset
 * The panel passes octaveShift = 0 (octave-free); the bridge adds the keyboard octave.
 * The octaveShift parameter is retained for unit tests.
 */
export function keyToNote(semitoneOffset: number, octaveShift: number): number {
  return KEYBED_LOW_NOTE + 12 * octaveShift + semitoneOffset;
}
