/**
 * Sound-manifest integrity. These lists are transcribed from a scanned 1988 manual via
 * OCR, so the risk is not a design mistake — it is a typo nobody notices until a program
 * loads the wrong waveform. Every assertion here is a transcription guard.
 */

import { describe, expect, it } from 'vitest';
import {
  DRUM_SOUND_COUNT,
  DRUM_SOUNDS,
  drumSoundAt,
  FIRST_SYNTHESIZED_MULTISOUND,
  MULTISOUND_COUNT,
  MULTISOUNDS,
  multisoundAt,
} from '../../data/sounds';

describe('multisound manifest', () => {
  it('has exactly 100 entries, indexed 0..99 with no gaps', () => {
    expect(MULTISOUNDS).toHaveLength(MULTISOUND_COUNT);
    MULTISOUNDS.forEach((m, i) => expect(m.index).toBe(i));
  });

  it('has no duplicate names', () => {
    const names = MULTISOUNDS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no empty or untrimmed names', () => {
    for (const m of MULTISOUNDS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.name).toBe(m.name.trim());
    }
  });

  it('the tracking flag agrees with the NT naming convention, in BOTH directions', () => {
    // The single most likely transcription error is an NT suffix dropped or a flag
    // missed. Deriving the expectation from the name catches either half independently.
    for (const m of MULTISOUNDS) {
      const namedNT = /NT\d?$/.test(m.name);
      expect(m.tracking, `${m.index} ${m.name}: name says NT=${namedNT}`).toBe(!namedNT);
    }
  });

  it('has exactly 14 no-tracking (fixed pitch) multisounds', () => {
    const nt = MULTISOUNDS.filter((m) => !m.tracking);
    expect(nt).toHaveLength(14);
    expect(nt.map((m) => m.index)).toEqual([24, 43, 47, 49, 53, 55, 57, 59, 62, 65, 67, 68, 75, 76]);
  });

  it('sharesSampleWith is set for exactly the NT sounds and null elsewhere', () => {
    for (const m of MULTISOUNDS) {
      if (m.tracking) expect(m.sharesSampleWith, `${m.index} ${m.name}`).toBeNull();
      else expect(m.sharesSampleWith, `${m.index} ${m.name}`).not.toBeNull();
    }
  });

  it('every NT sound points at a real, TRACKED, non-synthesized sibling', () => {
    // A stray NT entry whose sibling does not exist means the transcription invented a
    // sound; one pointing at another NT entry would make the build script chase a
    // sample that is itself a reference.
    for (const m of MULTISOUNDS.filter((x) => !x.tracking)) {
      const sib = multisoundAt(m.sharesSampleWith!);
      expect(sib, `${m.index} ${m.name} -> ${m.sharesSampleWith} does not exist`).toBeDefined();
      expect(sib!.tracking, `${m.name} -> ${sib!.name} is itself an NT sound`).toBe(true);
      expect(sib!.synthesized, `${m.name} -> ${sib!.name} is synthesized`).toBe(false);
      expect(sib!.sharesSampleWith).toBeNull();
    }
  });

  it('every NT sibling is the nearest preceding tracked sound', () => {
    // The manual lists each NT variant immediately after the sound it derives from. If a
    // pairing ever points somewhere else, a row was transcribed out of order.
    for (const m of MULTISOUNDS.filter((x) => !x.tracking)) {
      let expected = m.index - 1;
      while (expected >= 0 && !MULTISOUNDS[expected]!.tracking) expected--;
      expect(m.sharesSampleWith, `${m.index} ${m.name}`).toBe(expected);
    }
  });

  it('pins the abbreviated pairings the LCD names obscure', () => {
    // These three are why the pairing is declared data rather than derived from names.
    expect(multisoundAt(65)?.sharesSampleWith).toBe(64); // DistNT     -> Distortion
    expect(multisoundAt(67)?.sharesSampleWith).toBe(66); // BasThumNT1 -> BassThumb
    expect(multisoundAt(68)?.sharesSampleWith).toBe(66); // BasThumNT2 -> BassThumb
    expect(multisoundAt(75)?.sharesSampleWith).toBe(74); // VoiceWvNT1 -> VoiceWave
    expect(multisoundAt(76)?.sharesSampleWith).toBe(74); // VoiceWvNT2 -> VoiceWave
  });

  it('partitions 100 sounds into 63 to source, 14 NT references, 23 synthesized', () => {
    // The Phase 1 work estimate, as an assertion: only 63 multisounds actually need a
    // sample sourced. Deduping NT references and rendering the DWGS block cuts a
    // 100-sound sourcing problem down by more than a third.
    const toSource = MULTISOUNDS.filter((m) => !m.synthesized && m.sharesSampleWith === null);
    const ntRefs = MULTISOUNDS.filter((m) => m.sharesSampleWith !== null);
    const synthesized = MULTISOUNDS.filter((m) => m.synthesized);
    expect(toSource).toHaveLength(63);
    expect(ntRefs).toHaveLength(14);
    expect(synthesized).toHaveLength(23);
    expect(toSource.length + ntRefs.length + synthesized.length).toBe(MULTISOUND_COUNT);
  });

  it('marks 77..99 synthesized and 0..76 sampled', () => {
    for (const m of MULTISOUNDS) {
      expect(m.synthesized, `${m.index} ${m.name}`).toBe(m.index >= FIRST_SYNTHESIZED_MULTISOUND);
    }
    expect(MULTISOUNDS.filter((m) => m.synthesized)).toHaveLength(23);
  });

  it('the synthesized block is exactly the DWGS + geometric-wave names', () => {
    // If a sampled instrument name shows up in 77..99 the block boundary has drifted.
    for (const m of MULTISOUNDS.filter((x) => x.synthesized)) {
      expect(
        /^(DWGS |SquareWave|SawWave|Digital\d|\d+% Pulse)/.test(m.name),
        `${m.index} ${m.name} is in the synthesized block but is not a computed wave`,
      ).toBe(true);
    }
  });

  it('pins the sounds the acceptance tests depend on', () => {
    // Changing any of these silently retargets a fidelity gate.
    expect(multisoundAt(6)?.name).toBe('Organ2'); // I17 Organ 2 — the StoneBridge A/B
    expect(multisoundAt(0)?.name).toBe('A.Piano'); // I01 Piano 16'
    expect(multisoundAt(30)?.name).toBe('Choir'); // I00 Universe (Choir + Lore)
    expect(multisoundAt(42)?.name).toBe('Lore');
  });

  it('multisoundAt returns undefined out of range rather than throwing', () => {
    expect(multisoundAt(-1)).toBeUndefined();
    expect(multisoundAt(100)).toBeUndefined();
    expect(multisoundAt(99)?.name).toBe('DWGS Sine');
  });
});

describe('drum sound manifest', () => {
  it('has exactly 44 entries, indexed 1..44 with no gaps', () => {
    expect(DRUM_SOUNDS).toHaveLength(DRUM_SOUND_COUNT);
    DRUM_SOUNDS.forEach((d, i) => expect(d.index).toBe(i + 1));
  });

  it('is ONE-based — there is no drum 0', () => {
    // Multisounds are 0-based and drums are 1-based, exactly as the manual prints them.
    // Conflating the two off-by-one conventions would misalign every drum kit.
    expect(DRUM_SOUNDS[0]!.index).toBe(1);
    expect(drumSoundAt(0)).toBeUndefined();
    expect(drumSoundAt(1)?.name).toBe('Kick1');
    expect(drumSoundAt(44)?.name).toBe('Metronome2');
    expect(drumSoundAt(45)).toBeUndefined();
  });

  it('has no duplicate names', () => {
    const names = DRUM_SOUNDS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is the REAL list, not the decoy printed in the manual overview', () => {
    // The overview section carries an illustrative figure reading "BASS DRUM 1 /
    // PICCOLO SNARE / HI BONGO..." — a generic GM-style list the M1 does not have.
    const names = new Set(DRUM_SOUNDS.map((d) => d.name.toLowerCase()));
    for (const decoy of ['bass drum 1', 'piccolo snare', 'hi bongo', 'bassdrum1', 'hibongo']) {
      expect(names.has(decoy), `decoy name "${decoy}" leaked into the drum list`).toBe(false);
    }
    // and the real list's tells are present
    expect(names.has('kick1')).toBe(true);
    expect(names.has('sidestick')).toBe(true);
    expect(names.has('timbales1')).toBe(true);
  });

  it('keeps both metronome sounds — they cost a voice slot each', () => {
    // Authentic detail worth preserving: the metronome is a drum sound and claims a
    // slot from the same 16-slot pool during Combination playback.
    expect(drumSoundAt(43)?.name).toBe('Metronome1');
    expect(drumSoundAt(44)?.name).toBe('Metronome2');
  });
});
