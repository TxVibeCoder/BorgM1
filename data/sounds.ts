/**
 * THE sound manifests — 100 multisounds and 44 drum sounds, transcribed from the 1988
 * Owner's Manual. This is the contract the Phase 1 build script produces against and the
 * Phase 3 UI reads names from; the index IS the identity (Program parameters reference
 * multisounds by number, and the decoded factory bank in Phase 6 will too).
 *
 * PROVENANCE. Both lists appear TWICE in the Owner's Manual, in different layouts, and
 * were cross-checked against four independent OCR passes of two different scans. The
 * primary source is the "Multisound Waveform List" / "Drum Sound List" pages; two OCR
 * ambiguities were resolved against the second printing:
 *   - 68 read as a duplicate "BasThumNT1" in one pass; the second printing and the
 *     archive.org OCR both give "BasThumNT2", which the NT1/NT2 pairing also demands.
 *   - 76 read as "VoiceWvNt2" (lowercase t); the second printing gives "VoiceWvNT2".
 * Where the two printings disagree on spacing the tighter form is used, because the
 * hardware displays these on a 40x2 character LCD ("PanFlute", not "Pan Flute").
 *
 * NOT THE DECOY LIST. The Owner's Manual's overview section carries an illustrative
 * figure reading "BASS DRUM 1 / PICCOLO SNARE / HI BONGO..." — the M1 has none of those.
 * The real drum list is the one below (Kick1 / Snare1 / SideStick / Timbales...). The
 * Korg Super Guide also contradicts the Owner's Manual on drum-kit ranges; it is
 * pre-release marketing and the Owner's Manual wins.
 *
 * INDEXING IS NOT UNIFORM: multisounds are 0-based (00..99), drums are 1-based (01..44).
 * That is how the manual prints them and how the SysEx values run. Do not "fix" it.
 */

/**
 * `NT` = **No Tracking** — the sample plays at a FIXED pitch regardless of which key is
 * struck. The manual states it outright: "(NT) = same pitch regardless of key played".
 *
 * It does NOT mean "no transient", which is the natural misreading and would send the
 * sample pipeline looking for truncated attacks that do not exist. An NT multisound is
 * the same ROM sample as its tracked sibling with tracking switched off — 66 BassThumb
 * is tracked, 67/68 BasThumNT1/NT2 are the same sound pinned to two fixed pitches.
 */
export interface MultisoundDef {
  /** 0..99. The index IS the identity — Program parameters reference it by number. */
  index: number;
  /** Name as printed in the Owner's Manual. */
  name: string;
  /**
   * false = NT, fixed pitch regardless of key. A per-multisound boolean, not a zone
   * property: there are no velocity zones inside a multisound at all.
   */
  tracking: boolean;
  /**
   * For an NT sound: the index of the tracked multisound it shares a ROM sample with.
   * null for everything else.
   *
   * This is not decoration — it tells the Phase 1 build script NOT to source a separate
   * sample for an NT entry. Sourcing one would be both wasted work and wrong: the whole
   * point of an NT sound is that it is the *same recording* with tracking switched off,
   * so an independently-sourced sample would make the pair audibly different when the
   * hardware's are identical.
   *
   * Declared rather than derived from the name: the LCD abbreviations break any
   * mechanical match (BasThumNT1 -> BassThumb, VoiceWvNT1 -> VoiceWave, DistNT ->
   * Distortion). A heuristic loose enough to catch those would pair unrelated sounds.
   */
  sharesSampleWith: number | null;
  /**
   * true for 77..99 — these were COMPUTED waveforms on the hardware (Korg's DWGS
   * additive tables plus the plain geometric waves), not recordings. Phase 1 renders
   * them offline rather than sourcing samples for them, which is both more accurate and
   * free of licensing questions.
   */
  synthesized: boolean;
}

export interface DrumSoundDef {
  /** 1..44. One-based, as printed. */
  index: number;
  name: string;
}

/** Lowest synthesized (DWGS / geometric) multisound index. 77..99 inclusive. */
export const FIRST_SYNTHESIZED_MULTISOUND = 77;

export const MULTISOUND_COUNT = 100;
export const DRUM_SOUND_COUNT = 44;

/**
 * Raw transcription: [index, name, tracking, sharesSampleWith].
 * `synthesized` is derived from the index.
 */
const MULTISOUND_ROWS: ReadonlyArray<readonly [number, string, boolean, number | null]> = [
  [0, 'A.Piano', true, null],
  [1, 'E.Piano1', true, null],
  [2, 'E.Piano2', true, null],
  [3, 'Clav', true, null],
  [4, 'Harpsichord', true, null],
  [5, 'Organ1', true, null],
  [6, 'Organ2', true, null], // the acceptance-test sound (I17 Organ 2)
  [7, 'MagicOrgan', true, null],
  [8, 'Guitar1', true, null],
  [9, 'Guitar2', true, null],
  [10, 'E.Guitar', true, null],
  [11, 'Sitar1', true, null],
  [12, 'Sitar2', true, null],
  [13, 'A.Bass', true, null],
  [14, 'PickBass', true, null],
  [15, 'E.Bass', true, null],
  [16, 'Fretless', true, null],
  [17, 'SynthBass1', true, null],
  [18, 'SynthBass2', true, null],
  [19, 'Vibes', true, null],
  [20, 'Bell', true, null],
  [21, 'Tubular', true, null],
  [22, 'BellRing', true, null],
  [23, 'Karimba', true, null],
  [24, 'KarimbaNT', false, 23],
  [25, 'SynMallet', true, null],
  [26, 'Flute', true, null],
  [27, 'PanFlute', true, null],
  [28, 'Bottles', true, null],
  [29, 'Voices', true, null],
  [30, 'Choir', true, null],
  [31, 'Strings', true, null],
  [32, 'Brass1', true, null],
  [33, 'Brass2', true, null],
  [34, 'TenorSax', true, null],
  [35, 'MuteTP', true, null],
  [36, 'Trumpet', true, null],
  [37, 'TubaFlugel', true, null],
  [38, 'DoubleReed', true, null],
  [39, 'KotoTrem', true, null],
  [40, 'BambooTrem', true, null],
  [41, 'Rhythm', true, null],
  [42, 'Lore', true, null],
  [43, 'LoreNT', false, 42],
  [44, 'Flexatone', true, null],
  [45, 'WindBells', true, null],
  [46, 'Pole', true, null],
  [47, 'PoleNT', false, 46],
  [48, 'Block', true, null],
  [49, 'BlockNT', false, 48],
  [50, 'FingerSnap', true, null],
  [51, 'Pop', true, null],
  [52, 'Drop', true, null],
  [53, 'DropNT', false, 52],
  [54, 'Breath', true, null],
  [55, 'BreathNT', false, 54],
  [56, 'Pluck', true, null],
  [57, 'PluckNT', false, 56],
  [58, 'VibeHit', true, null],
  [59, 'VibeHitNT', false, 58],
  [60, 'Hammer', true, null],
  [61, 'MetalHit', true, null],
  [62, 'MetalHitNT', false, 61],
  [63, 'Pick', true, null],
  [64, 'Distortion', true, null],
  [65, 'DistNT', false, 64],
  [66, 'BassThumb', true, null],
  [67, 'BasThumNT1', false, 66],
  [68, 'BasThumNT2', false, 66],
  [69, 'Wire', true, null],
  [70, 'PanWave', true, null],
  [71, 'PingWave', true, null],
  [72, 'FvWave', true, null],
  [73, 'MvWave', true, null],
  [74, 'VoiceWave', true, null],
  [75, 'VoiceWvNT1', false, 74],
  [76, 'VoiceWvNT2', false, 74],
  // --- 77..99: computed on the hardware, rendered offline here ---
  [77, 'DWGS EP1', true, null],
  [78, 'DWGS EP2', true, null],
  [79, 'DWGS EP3', true, null],
  [80, 'DWGS Piano', true, null],
  [81, 'DWGS Clav', true, null],
  [82, 'DWGS Vibe1', true, null],
  [83, 'DWGS Bass1', true, null],
  [84, 'DWGS Bass2', true, null],
  [85, 'DWGS Bell1', true, null],
  [86, 'DWGS Orgn1', true, null],
  [87, 'DWGS Orgn2', true, null],
  [88, 'DWGS Voice', true, null],
  [89, 'SquareWave', true, null],
  [90, 'Digital1', true, null],
  [91, 'SawWave', true, null],
  [92, 'Digital2', true, null],
  [93, '25% Pulse', true, null],
  [94, '10% Pulse', true, null],
  [95, 'Digital3', true, null],
  [96, 'Digital4', true, null],
  [97, 'Digital5', true, null],
  [98, 'DWGS Tri', true, null],
  [99, 'DWGS Sine', true, null],
];

export const MULTISOUNDS: readonly MultisoundDef[] = MULTISOUND_ROWS.map(
  ([index, name, tracking, sharesSampleWith]) => ({
    index,
    name,
    tracking,
    sharesSampleWith,
    synthesized: index >= FIRST_SYNTHESIZED_MULTISOUND,
  }),
);

const DRUM_NAMES: readonly string[] = [
  'Kick1', // 01
  'Kick2',
  'Kick3',
  'Snare1',
  'Snare2',
  'Snare3',
  'Snare4',
  'SideStick',
  'Tom1',
  'Tom2', // 10
  'ClosedHH1',
  'OpenHH1',
  'ClosedHH2',
  'OpenHH2',
  'Crash',
  'Conga1',
  'Conga2',
  'Timbales1',
  'Timbales2',
  'Cowbell', // 20
  'Claps',
  'Tambourine',
  'E.Tom',
  'Ride',
  'Rap',
  'Whip',
  'Shaker',
  'Pole',
  'Block',
  'FingerSnap', // 30
  'Drop',
  'VibeHit',
  'Hammer',
  'MetalHit',
  'Pluck',
  'FlexaTone',
  'WindBell',
  'Tubular1',
  'Tubular2',
  'Tubular3', // 40
  'Tubular4',
  'BellRing',
  'Metronome1',
  'Metronome2', // 44
];

export const DRUM_SOUNDS: readonly DrumSoundDef[] = DRUM_NAMES.map((name, i) => ({
  index: i + 1,
  name,
}));

/** Lookup by index. Returns undefined for an out-of-range index rather than throwing. */
export function multisoundAt(index: number): MultisoundDef | undefined {
  return MULTISOUNDS[index];
}

/** Lookup by 1-based drum index. */
export function drumSoundAt(index: number): DrumSoundDef | undefined {
  return DRUM_SOUNDS[index - 1];
}
