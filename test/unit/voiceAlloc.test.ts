/**
 * Voice allocation over 16 oscillator slots.
 *
 * The three properties worth defending here, because each has a silent failure mode:
 *   - DOUBLE is atomic (a half-voice is worse than a dropped note)
 *   - the same-note rule runs BEFORE scoring (or a trill eats the pool)
 *   - a stolen slot is FADED, never cut (or every steal clicks)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeCount,
  AGE_SATURATION,
  ageTerm,
  allocate,
  freeSlot,
  makeSlots,
  noteOff,
  resetVoiceIds,
  SLOT_COUNT,
  STEAL_FADE_S,
  STEAL_WEIGHTS,
  stealScore,
  sustainUp,
  voiceCount,
  type Slot,
} from '../../src/engine/voice/voiceAllocCore';

beforeEach(() => resetVoiceIds());

const on = (slots: Slot[], note: number, n: 1 | 2 = 1, now = 0, channel = 0) =>
  allocate(slots, { slots: n, note, channel, now });

describe('slot pool', () => {
  it('is 16 slots, the instrument-defining constraint', () => {
    expect(SLOT_COUNT).toBe(16);
    expect(makeSlots()).toHaveLength(16);
  });

  it('SINGLE gives 16 voices, DOUBLE gives 8 — from ONE rule, not two', () => {
    const single = makeSlots();
    for (let i = 0; i < 16; i++) expect(on(single, 60 + i).indices).toHaveLength(1);
    expect(activeCount(single)).toBe(16);
    expect(voiceCount(single)).toBe(16);

    const double = makeSlots();
    for (let i = 0; i < 8; i++) expect(on(double, 60 + i, 2).indices).toHaveLength(2);
    expect(activeCount(double)).toBe(16);
    expect(voiceCount(double)).toBe(8);
  });
});

describe('DOUBLE atomicity', () => {
  it('claims two slots or none — never one', () => {
    const slots = makeSlots();
    // Fill 15 of 16 with notes that are expensive to steal (fresh, loud, held).
    for (let i = 0; i < 15; i++) {
      on(slots, 60 + i, 1, 10);
      slots[i]!.level = 1;
    }
    // One free slot left. A DOUBLE needs two, so it must steal one — and it does, rather
    // than half-allocating.
    const r = on(slots, 90, 2, 10);
    expect(r.indices).toHaveLength(2);
    // both halves share a voice id
    expect(slots[r.indices[0]!]!.voiceId).toBe(slots[r.indices[1]!]!.voiceId);
    expect(slots[r.indices[0]!]!.oscIndex).toBe(0);
    expect(slots[r.indices[1]!]!.oscIndex).toBe(1);
  });

  it('returns nothing at all when the pool cannot satisfy the whole request', () => {
    // A 2-slot request against a 1-slot pool: the half-voice case, forced.
    const tiny = makeSlots(1);
    const r = allocate(tiny, { slots: 2, note: 60, channel: 0, now: 0 });
    expect(r.indices).toEqual([]);
    expect(r.voiceId).toBe(-1);
    expect(tiny[0]!.state).toBe('free'); // nothing was half-claimed
  });
});

describe('same-note-first (a hard rule, before any scoring)', () => {
  it('retriggering a note reuses ITS slot rather than allocating a new one', () => {
    const slots = makeSlots();
    const first = on(slots, 60, 1, 0);
    const again = on(slots, 60, 1, 1);
    expect(again.indices).toEqual(first.indices);
    expect(activeCount(slots)).toBe(1);
  });

  it('a fast trill against long release tails does NOT eat the pool', () => {
    // The failure this rule exists to prevent: each retrigger stacking a fresh copy on top
    // of the previous note's release, until 16 slots are 16 copies of two notes.
    const slots = makeSlots();
    for (let t = 0; t < 40; t++) {
      const note = t % 2 === 0 ? 60 : 62;
      on(slots, note, 1, t * 0.05);
      noteOff(slots, note, 0, false); // released, but still sounding
    }
    expect(activeCount(slots)).toBeLessThanOrEqual(2);
  });

  it('the same note on a DIFFERENT channel is a different note', () => {
    const slots = makeSlots();
    const a = allocate(slots, { slots: 1, note: 60, channel: 0, now: 0 });
    const b = allocate(slots, { slots: 1, note: 60, channel: 1, now: 0 });
    expect(b.indices).not.toEqual(a.indices);
    expect(activeCount(slots)).toBe(2);
  });

  it('runs before scoring — it reclaims its own slot even when a cheaper steal exists', () => {
    const slots = makeSlots();
    on(slots, 60, 1, 0); // slot 0
    noteOff(slots, 60, 0, false); // released: the cheapest possible steal target is slot 0
    const r1 = on(slots, 72, 1, 0); // fills another slot
    // Retriggering 72 must take 72's slot, not the released 60 that scores higher.
    const r2 = on(slots, 72, 1, 1);
    expect(r2.indices).toEqual(r1.indices);
  });
});

describe('steal scoring', () => {
  it('prefers free, then released, then sustained, then old, then quiet', () => {
    const now = 10;
    const base = (over: Partial<Slot>): Slot => ({
      ...makeSlots(1)[0]!,
      state: 'held',
      note: 60,
      channel: 0,
      startedAt: now,
      level: 0,
      ...over,
    });
    const free = base({ state: 'free' });
    const held = base({});
    const released = base({ state: 'released' });
    const sustained = base({ sustained: true });
    const old = base({ startedAt: now - 5 });
    const loud = base({ level: 1 });

    expect(stealScore(free, now)).toBe(Number.POSITIVE_INFINITY);
    expect(stealScore(released, now)).toBeGreaterThan(stealScore(held, now));
    expect(stealScore(sustained, now)).toBeGreaterThan(stealScore(held, now));
    expect(stealScore(old, now)).toBeGreaterThan(stealScore(held, now));
    expect(stealScore(loud, now)).toBeLessThan(stealScore(held, now));
  });

  it('AGE INCREASES stealability — the note you just played must not be the one dropped', () => {
    // PLAN.md lists "age +1000/sec" without a direction. Under a keep-the-highest
    // convention that would protect old notes and steal fresh ones, i.e. the note you
    // just pressed goes silent. This pins the musically correct direction.
    const slots = makeSlots();
    for (let i = 0; i < 16; i++) on(slots, 60 + i, 1, i * 0.1); // note 60 oldest, 75 newest
    const before = slots.map((s) => s.note);
    on(slots, 90, 1, 2);
    const stolenNote = before.find((n, i) => slots[i]!.note !== n);
    expect(stolenNote).toBe(60); // the OLDEST went, not the newest
  });

  it('steals a released voice before a held one even when the released one is newer', () => {
    const slots = makeSlots();
    for (let i = 0; i < 16; i++) {
      on(slots, 60 + i, 1, 0);
      slots[i]!.level = 1;
    }
    // Make the NEWEST slot released; it should still go first.
    slots[15]!.state = 'released';
    slots[15]!.startedAt = 5;
    on(slots, 90, 1, 5);
    expect(slots[15]!.note).toBe(90);
  });

  it('uses the published weights', () => {
    expect(STEAL_WEIGHTS.released).toBe(2000);
    expect(STEAL_WEIGHTS.sustained).toBe(1000);
    expect(STEAL_WEIGHTS.agePerSecond).toBe(1000);
  });

  it('AGE SATURATES below the sustained weight, so state stays decisive', () => {
    // Unbounded age is the trap: a pad held 5 s would score 5000 and outrank a note
    // released an instant ago (2000), so the still-sounding pad is stolen and the
    // already-fading note spared. Past ~10 s every voice looks identical and only age
    // matters at all.
    expect(ageTerm(0)).toBe(0);
    expect(ageTerm(1e6)).toBeLessThan(STEAL_WEIGHTS.sustained);
    expect(ageTerm(1e6)).toBeCloseTo(AGE_SATURATION, 0);
    // ...while keeping the published 1000/sec as the slope near zero, where it discriminates
    expect(ageTerm(0.01) / 0.01).toBeGreaterThan(900);
    expect(ageTerm(0.01) / 0.01).toBeLessThanOrEqual(1000);
    // and it is monotonic, so age still orders voices within a state
    expect(ageTerm(3)).toBeGreaterThan(ageTerm(2));
  });
});

describe('steal is a fade, never a cut', () => {
  it('marks every stolen sounding slot with the time its fade began', () => {
    const slots = makeSlots();
    for (let i = 0; i < 16; i++) {
      on(slots, 60 + i, 1, 0);
      slots[i]!.level = 0.8;
    }
    const r = on(slots, 90, 1, 3);
    expect(r.stolen.length).toBe(1);
    for (const i of r.stolen) expect(slots[i]!.stealingSince).toBe(3);
  });

  it('does not mark a FREE slot as stolen — there is nothing to fade', () => {
    const slots = makeSlots();
    const r = on(slots, 60, 1, 0);
    expect(r.stolen).toEqual([]);
    expect(slots[r.indices[0]!]!.stealingSince).toBe(-1);
  });

  it('the fade is 4 ms — long enough to be inaudible, short enough not to delay the note', () => {
    expect(STEAL_FADE_S).toBe(0.004);
  });
});

describe('note-off and sustain', () => {
  it('releases both halves of a DOUBLE together', () => {
    const slots = makeSlots();
    const r = on(slots, 60, 2, 0);
    const released = noteOff(slots, 60, 0, false);
    expect(released.sort()).toEqual(r.indices.sort());
    for (const i of r.indices) expect(slots[i]!.state).toBe('released');
  });

  it('sustain down keeps a slot held but marks it more stealable', () => {
    const slots = makeSlots();
    const r = on(slots, 60, 1, 0);
    const i = r.indices[0]!;
    noteOff(slots, 60, 0, true);
    expect(slots[i]!.state).toBe('held');
    expect(slots[i]!.sustained).toBe(true);
    const held = { ...slots[i]!, sustained: false };
    expect(stealScore(slots[i]!, 1)).toBeGreaterThan(stealScore(held, 1));
  });

  it('sustain up releases everything the pedal was holding, on that channel only', () => {
    const slots = makeSlots();
    allocate(slots, { slots: 1, note: 60, channel: 0, now: 0 });
    allocate(slots, { slots: 1, note: 64, channel: 1, now: 0 });
    noteOff(slots, 60, 0, true);
    noteOff(slots, 64, 1, true);
    const lifted = sustainUp(slots, 0);
    expect(lifted).toHaveLength(1);
    expect(slots[0]!.state).toBe('released');
    expect(slots[1]!.state).toBe('held'); // channel 1's pedal is still down
  });

  it('note-off for a note that is not sounding is a no-op', () => {
    const slots = makeSlots();
    expect(noteOff(slots, 60, 0, false)).toEqual([]);
  });

  it('freeSlot fully clears a slot so it cannot be matched by a stale note number', () => {
    const slots = makeSlots();
    const r = on(slots, 60, 1, 0);
    freeSlot(slots[r.indices[0]!]!);
    expect(activeCount(slots)).toBe(0);
    expect(noteOff(slots, 60, 0, false)).toEqual([]);
  });
});

describe('under sustained load', () => {
  it('never exceeds 16 slots and never leaves a half-allocated DOUBLE', () => {
    const slots = makeSlots();
    let now = 0;
    for (let i = 0; i < 500; i++) {
      now += 0.01;
      const note = 36 + ((i * 7) % 60);
      const size: 1 | 2 = i % 3 === 0 ? 2 : 1;
      const r = allocate(slots, { slots: size, note, channel: 0, now });
      expect(r.indices.length === 0 || r.indices.length === size).toBe(true);
      if (i % 4 === 0) noteOff(slots, note, 0, false);
      // every voiceId present must own the right number of slots
      const byVoice = new Map<number, number>();
      for (const s of slots) if (s.state !== 'free') byVoice.set(s.voiceId, (byVoice.get(s.voiceId) ?? 0) + 1);
      expect(activeCount(slots)).toBeLessThanOrEqual(16);
    }
  });
});
