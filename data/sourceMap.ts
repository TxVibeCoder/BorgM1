/**
 * Where each M1 sound's audio comes from. BUILD-TIME data — read by
 * `scripts/buildBank.ts`, never by the app.
 *
 * FluidR3_GM (MIT) is the spine. Every entry names a General MIDI preset by program
 * number, which is stable across any GM-compliant bank, so swapping in a better-sourced
 * SF2 later is a config change rather than a rewrite.
 *
 * `approx: true` MARKS A SUBSTITUTION, and there are a lot of them, on purpose. Roughly a
 * third of the M1's multisounds are sounds General MIDI simply does not have a slot for —
 * `Lore`, `PanWave`, `FvWave`, `MvWave`, `Wire`, `Rhythm` are M1-specific synthesised
 * textures, and `Pole`, `Block`, `Drop`, `Pop` are one-shot percussion the GM melodic set
 * never contemplated. Rather than leave those silent, each maps to the nearest GM timbre
 * and is flagged. The flag is the point: it is the shortlist for the selective upgrades
 * (Greg Sullivan E-Pianos CC-BY, FreePats CC0 organ, VCSL and VSCO 2 CE CC0) once the
 * instrument is playable and it is possible to hear which substitutions actually hurt.
 *
 * NOT SOURCED HERE, deliberately:
 *   - the 14 NT multisounds — they reuse their tracked sibling's audio (`sharesSampleWith`
 *     in data/sounds.ts); sourcing a second recording would make the pair audibly
 *     different where the hardware's are identical.
 *   - multisounds 77..99 — computed on the hardware, rendered additively by
 *     src/engine/sample/dwgsCore.ts.
 */

/** A General MIDI melodic preset, by program number in bank 0. */
export interface MelodicSource {
  kind: 'melodic';
  /** GM program number, 0..127. */
  program: number;
  /** Human-readable preset name, for build logs and CREDITS. */
  preset: string;
  /** true when this is the nearest available timbre rather than the right one. */
  approx?: boolean;
}

/** A single note out of a GM drum kit, or out of a melodic preset played at one pitch. */
export interface DrumSource {
  kind: 'drum';
  /** Kit preset program (0 Standard, 8 Room, 16 Power, 24 Electronic, 25 TR-808, ...). */
  kitProgram: number;
  /** Kit name, for logs. */
  preset: string;
  /** MIDI note within the kit. */
  note: number;
  approx?: boolean;
}

/** A drum sound sourced from a melodic preset at a fixed pitch (bells, mallets, hits). */
export interface PitchedHitSource {
  kind: 'pitchedHit';
  program: number;
  preset: string;
  note: number;
  approx?: boolean;
}

export type SoundSource = MelodicSource | DrumSource | PitchedHitSource;

const m = (program: number, preset: string, approx = false): MelodicSource => ({
  kind: 'melodic',
  program,
  preset,
  ...(approx ? { approx: true } : {}),
});

const kit = (kitProgram: number, preset: string, note: number, approx = false): DrumSource => ({
  kind: 'drum',
  kitProgram,
  preset,
  note,
  ...(approx ? { approx: true } : {}),
});

const hit = (program: number, preset: string, note: number, approx = false): PitchedHitSource => ({
  kind: 'pitchedHit',
  program,
  preset,
  note,
  ...(approx ? { approx: true } : {}),
});

/**
 * Multisound index -> source. Exactly the 63 sounds that are neither NT references nor
 * synthesized; a test asserts the key set matches data/sounds.ts, so this cannot silently
 * drift out of step with the manifest.
 */
export const MULTISOUND_SOURCES: Readonly<Record<number, MelodicSource>> = {
  0: m(0, 'Yamaha Grand Piano'),
  1: m(4, 'Rhodes EP'),
  2: m(5, 'Legend EP 2'),
  3: m(7, 'Clavinet'),
  4: m(6, 'Harpsichord'),
  5: m(16, 'DrawbarOrgan'),
  // THE acceptance-test sound. I17 Organ 2 A/Bs against Robin S "Show Me Love"
  // (StoneBridge Mix); its filter and amp envelopes are flat, so the sample carries the
  // whole character. Percussive Organ is the closest GM drawbar timbre with the attack
  // click the patch depends on.
  6: m(17, 'Percussive Organ'),
  7: m(18, 'Rock Organ'),
  8: m(24, 'Nylon String Guitar'),
  9: m(25, 'Steel String Guitar'),
  10: m(27, 'Clean Guitar'),
  11: m(104, 'Sitar'),
  12: m(106, 'Shamisen', true), // FluidR3 has one sitar; nearest distinct plucked-Eastern
  13: m(32, 'Acoustic Bass'),
  14: m(34, 'Picked Bass'),
  15: m(33, 'Fingered Bass'),
  16: m(35, 'Fretless Bass'),
  17: m(38, 'Synth Bass 1'),
  18: m(39, 'Synth Bass 2'),
  19: m(11, 'Vibraphone'),
  20: m(9, 'Glockenspiel'),
  21: m(14, 'Tubular Bells'),
  22: m(112, 'Tinker Bell', true),
  23: m(108, 'Kalimba'),
  25: m(10, 'Music Box', true),
  26: m(73, 'Flute'),
  27: m(75, 'Pan Flute'),
  28: m(76, 'Bottle Chiff'),
  29: m(53, 'Ohh Voices'),
  30: m(52, 'Ahh Choir'), // I00 Universe layers this with Lore
  31: m(48, 'Strings'),
  32: m(61, 'Brass Section'),
  33: m(62, 'Synth Brass 1'),
  34: m(66, 'Tenor Sax'),
  35: m(59, 'Muted Trumpet'),
  36: m(56, 'Trumpet'),
  37: m(58, 'Tuba'),
  38: m(68, 'Oboe'),
  39: m(107, 'Koto'),
  40: m(77, 'Shakuhachi'),
  41: m(118, 'Synth Drum', true), // M1 "Rhythm" is a rhythmic texture GM has no slot for
  42: m(98, 'Crystal', true), // Lore — the other half of I00 Universe
  44: m(113, 'Agogo', true),
  45: m(96, 'Ice Rain', true),
  46: m(117, 'Melodic Tom', true),
  48: m(115, 'Woodblock'),
  50: m(120, 'Fret Noise', true),
  51: m(121, 'Breath Noise', true),
  52: m(102, 'Echo Drops', true),
  54: m(121, 'Breath Noise'),
  56: m(45, 'Pizzicato Section', true),
  58: m(11, 'Vibraphone', true),
  60: m(116, 'Taiko Drum', true),
  61: m(114, 'Steel Drums', true),
  63: m(120, 'Fret Noise', true),
  64: m(30, 'Distortion Guitar'),
  66: m(36, 'Slap Bass'),
  69: m(31, 'Guitar Harmonics', true),
  70: m(91, 'Space Voice', true),
  71: m(100, 'Brightness', true),
  72: m(88, 'Fantasia', true),
  73: m(90, 'Polysynth', true),
  74: m(54, 'Synth Voice', true),
};

/**
 * Drum index (1..44) -> source.
 *
 * Two kinds, because the M1's drum list is not a GM kit: about a third of it is pitched
 * metal and mallet hits (four tubular bells, a vibe hit, two metronome clicks) that no
 * percussion kit contains. Those pull a single note from a melodic preset instead. Mixing
 * both kinds through one table beats forcing everything into kit notes and getting four
 * identical triangles where four tuned tubular bells belong.
 *
 * DIFFERENT KITS ARE USED ON PURPOSE for the numbered variants — Kick1/2/3 come from
 * Standard/Room/TR-808 rather than from one kit three times, so they are actually three
 * different kicks the way the M1's are.
 */
export const DRUM_SOURCES: Readonly<Record<number, DrumSource | PitchedHitSource>> = {
  1: kit(0, 'Standard', 36), // Bass Drum 1
  2: kit(8, 'Room', 36),
  3: kit(25, 'TR-808', 36),
  4: kit(0, 'Standard', 38), // Acoustic Snare
  5: kit(0, 'Standard', 40), // Electric Snare
  6: kit(16, 'Power', 38),
  7: kit(25, 'TR-808', 38),
  8: kit(0, 'Standard', 37), // Side Stick
  9: kit(0, 'Standard', 45), // Low Tom
  10: kit(0, 'Standard', 48), // Hi-Mid Tom
  11: kit(0, 'Standard', 42), // Closed Hi Hat
  12: kit(0, 'Standard', 46), // Open Hi Hat
  13: kit(25, 'TR-808', 42),
  14: kit(25, 'TR-808', 46),
  15: kit(0, 'Standard', 49), // Crash Cymbal 1
  16: kit(0, 'Standard', 63), // Open Hi Conga
  17: kit(0, 'Standard', 64), // Low Conga
  18: kit(0, 'Standard', 65), // High Timbale
  19: kit(0, 'Standard', 66), // Low Timbale
  20: kit(0, 'Standard', 56), // Cowbell
  21: kit(0, 'Standard', 39), // Hand Clap
  22: kit(0, 'Standard', 54), // Tambourine
  23: kit(24, 'Electronic', 50), // High Tom, electronic kit
  24: kit(0, 'Standard', 51), // Ride Cymbal 1
  // "Rap" is a vocal stab; GM has nothing like it. NOT another kit's note 39 — FluidR3's
  // kits share one clap sample, so Standard/Room/Power/39 are the same audio and the
  // duplicate check rejects them. Orchestra Hit is at least a distinct stab.
  25: hit(55, 'Orchestra Hit', 60, true),
  26: kit(0, 'Standard', 58, true), // Vibraslap standing in for Whip
  27: kit(0, 'Standard', 70), // Maracas
  28: kit(0, 'Standard', 76, true), // Hi Wood Block for Pole
  29: kit(0, 'Standard', 77), // Low Wood Block
  30: hit(115, 'Woodblock', 96, true), // FingerSnap — a high tick; note 96 keeps it clear
  //                                      of the metronome clicks at 84 and 72
  31: kit(0, 'Standard', 78, true), // Mute Cuica for Drop
  32: hit(11, 'Vibraphone', 72), // VibeHit
  33: hit(116, 'Taiko Drum', 48, true), // Hammer
  34: hit(114, 'Steel Drums', 60, true), // MetalHit
  35: hit(45, 'Pizzicato Section', 60), // Pluck
  36: hit(113, 'Agogo', 72, true), // FlexaTone
  37: hit(112, 'Tinker Bell', 84, true), // WindBell
  // The four tubular bells are one preset at four pitches, which is what they are on the
  // M1 too — a tuned set, not four unrelated samples.
  38: hit(14, 'Tubular Bells', 60),
  39: hit(14, 'Tubular Bells', 65),
  40: hit(14, 'Tubular Bells', 69),
  41: hit(14, 'Tubular Bells', 72),
  42: hit(112, 'Tinker Bell', 96, true), // BellRing
  43: hit(115, 'Woodblock', 84, true), // Metronome1 — the downbeat click
  44: hit(115, 'Woodblock', 72, true), // Metronome2 — the beat click
};
