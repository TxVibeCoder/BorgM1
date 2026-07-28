/**
 * Voice allocation — PURE, no Web Audio types, no clock of its own, Node-testable.
 * Time is always passed in (`now`), so the whole thing is deterministic.
 *
 * SIXTEEN OSCILLATOR SLOTS, NOT SIXTEEN VOICES. That one rule reproduces the M1's
 * polyphony everywhere: SINGLE and DRUMS cost one slot, DOUBLE costs two, and the same
 * pool serves Program mode (16 notes single / 8 double) and Combinations ("no per-program
 * limit, but never more than 16 total") with no special-casing anywhere else.
 *
 * DOUBLE CLAIMS BOTH SLOTS ATOMICALLY. Allocating one and failing the other yields a
 * half-voice — one oscillator of a two-oscillator patch, at the wrong level, with the
 * wrong timbre. That is worse than dropping the note, so `allocate` either returns every
 * slot it was asked for or none at all.
 */

/** Total oscillator slots. Not a tunable — it is the instrument's defining constraint. */
export const SLOT_COUNT = 16;

/**
 * Forced fade applied when a sounding slot is stolen, in seconds.
 *
 * A hard kill is a step discontinuity, i.e. a click, and voice steal happens exactly when
 * the mix is busiest and a click is most audible. 4 ms is long enough to be inaudible and
 * short enough that the stealing note is not noticeably late.
 */
export const STEAL_FADE_S = 0.004;

export type SlotState =
  /** Nothing here. */
  | 'free'
  /** Key down, envelope running. */
  | 'held'
  /** Key up, envelope releasing, still sounding. */
  | 'released'
  /** Stolen: fading out over STEAL_FADE_S, then becomes free. */
  | 'stealing';

export interface Slot {
  state: SlotState;
  /** MIDI note, or -1 when free. */
  note: number;
  /** MIDI channel, or -1 when free. */
  channel: number;
  /**
   * Which Combination timbre owns this slot (0..7), or -1 when free. Program mode uses 0.
   *
   * THE SAME-NOTE RULE NEEDS THIS, and it is the one thing Combinations genuinely add to the
   * allocator. Two timbres of a LAYER are a different sound on the SAME note and the SAME
   * channel — the factory bank puts all eight timbres on channel 1 — so keying "this is the
   * same note" on (note, channel) alone would make timbre 2's note-on steal timbre 1's slots
   * and a layer would collapse to whichever timbre allocated last.
   */
  timbre: number;
  /**
   * Groups the slots of one logical voice. Both halves of a DOUBLE share an id, so a
   * note-off releases both and neither can be stolen without the other being considered.
   */
  voiceId: number;
  /** Which half of the voice this slot is (0 or 1). */
  oscIndex: number;
  /** `now` at note-on. Drives the age term. */
  startedAt: number;
  /** `now` when the steal fade began; -1 otherwise. */
  stealingSince: number;
  /** Current envelope output, 0..1. Drives the loudness term. */
  level: number;
  /** Sustain pedal is holding this slot after key release. */
  sustained: boolean;
}

export function makeSlot(): Slot {
  return {
    state: 'free',
    note: -1,
    channel: -1,
    timbre: -1,
    voiceId: -1,
    oscIndex: 0,
    startedAt: 0,
    stealingSince: -1,
    level: 0,
    sustained: false,
  };
}

export function makeSlots(count = SLOT_COUNT): Slot[] {
  return Array.from({ length: count }, makeSlot);
}

/**
 * Steal weights.
 *
 * UNDOCUMENTED — the M1's real rule is not published. These are FluidSynth's, which is a
 * defensible starting point rather than a measurement. LABEL THIS A CHOICE IN ANY
 * DISCUSSION OF FIDELITY.
 *
 * SIGN CONVENTION: higher score = stolen sooner. PLAN.md lists the age term as
 * "+1000/sec" without stating a direction; taken literally under a keep-the-highest
 * convention it would protect old notes and steal new ones, which means the note you just
 * played is the one that goes silent — audibly backwards. Implemented so that age
 * increases stealability, which is both the musically correct direction and what
 * FluidSynth actually does (it lowers the priority of older voices).
 */
export const STEAL_WEIGHTS = {
  /** A releasing voice is already on its way out. */
  released: 2000,
  /** Held by the sustain pedal rather than by a finger. */
  sustained: 1000,
  /** Per second of age, NEAR AGE ZERO — see ageTerm, this saturates. */
  agePerSecond: 1000,
  /** Per unit of current level. Loud voices are the ones you would hear disappear. */
  loudness: -500,
} as const;

/**
 * Age contribution SATURATES, and that is a deliberate correction to the naive weighting.
 *
 * A raw `age * 1000` is unbounded, so after a few seconds it swamps everything: a pad held
 * for five seconds scores 5000 and a note released an instant ago scores 2000, meaning the
 * still-sounding pad is stolen and the already-fading note is spared. Worse, past ~10
 * seconds every voice's score is dominated by age alone and the released, sustained and
 * loudness terms stop distinguishing anything at all.
 *
 * Saturating at just under the `sustained` weight restores the intended precedence —
 * released beats sustained beats held, with age ordering voices WITHIN a state and
 * loudness fine-tuning — while keeping the published 1000/sec as the slope near zero,
 * which is where it actually discriminates. AGE_TAU is derived from that: an exponential
 * approach to AGE_SATURATION has initial slope AGE_SATURATION/AGE_TAU, so tau ~= 1 s.
 */
export const AGE_SATURATION = 999;
export const AGE_TAU_S = AGE_SATURATION / STEAL_WEIGHTS.agePerSecond;

/** Bounded age term, 0 at age 0, approaching AGE_SATURATION. */
export function ageTerm(ageSeconds: number): number {
  if (ageSeconds <= 0) return 0;
  return AGE_SATURATION * (1 - Math.exp(-ageSeconds / AGE_TAU_S));
}

/** How stealable a slot is right now. Higher = steal sooner. */
export function stealScore(slot: Slot, now: number): number {
  if (slot.state === 'free') return Number.POSITIVE_INFINITY;
  // Already fading out — reuse before touching anything still sounding properly.
  if (slot.state === 'stealing') return Number.MAX_SAFE_INTEGER;
  let score = 0;
  if (slot.state === 'released') score += STEAL_WEIGHTS.released;
  if (slot.sustained) score += STEAL_WEIGHTS.sustained;
  score += ageTerm(now - slot.startedAt);
  score += slot.level * STEAL_WEIGHTS.loudness;
  return score;
}

export interface AllocationRequest {
  /** 1 for SINGLE and DRUMS, 2 for DOUBLE. */
  slots: 1 | 2;
  note: number;
  channel: number;
  /** Combination timbre 0..7. Program mode passes 0. See `Slot.timbre`. */
  timbre?: number;
  now: number;
}

export interface AllocationResult {
  /** Slot indices claimed, in oscillator order. Empty when nothing could be allocated. */
  indices: number[];
  /** Slots that were stolen and must be faded rather than cut. */
  stolen: number[];
  voiceId: number;
}

let nextVoiceId = 1;

/** Reset the voice-id counter. Tests only — keeps golden buffers reproducible. */
export function resetVoiceIds(): void {
  nextVoiceId = 1;
}

/**
 * Claim `req.slots` slots, stealing if necessary.
 *
 * Order of preference:
 *   1. THE SAME NOTE ON THE SAME CHANNEL — a hard rule that runs BEFORE any scoring.
 *      Retriggering a note must reuse its own slots, or a trill against a long release
 *      tail piles up copies of one note and eats the whole pool. No weighting can express
 *      "this is the same note"; it has to be a rule.
 *   2. Free slots.
 *   3. The highest-scoring sounding slots (see stealScore).
 */
export function allocate(slots: Slot[], req: AllocationRequest): AllocationResult {
  const need = req.slots;
  const timbre = req.timbre ?? 0;
  const claimed: number[] = [];
  const stolen: number[] = [];

  // 1. same note, same channel, SAME TIMBRE — take these first, in oscillator order.
  //    The timbre term is what keeps a LAYER from collapsing; see `Slot.timbre`.
  for (let i = 0; i < slots.length && claimed.length < need; i++) {
    const s = slots[i]!;
    if (
      s.state !== 'free' &&
      s.note === req.note &&
      s.channel === req.channel &&
      s.timbre === timbre
    ) {
      claimed.push(i);
      stolen.push(i);
    }
  }

  // 2. free slots.
  for (let i = 0; i < slots.length && claimed.length < need; i++) {
    if (slots[i]!.state === 'free' && !claimed.includes(i)) claimed.push(i);
  }

  // 3. steal the most expendable.
  if (claimed.length < need) {
    const candidates = slots
      .map((s, i) => ({ i, score: stealScore(s, req.now) }))
      .filter((c) => !claimed.includes(c.i))
      .sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (claimed.length >= need) break;
      claimed.push(c.i);
      stolen.push(c.i);
    }
  }

  // ATOMICITY: a DOUBLE that could only get one slot gets none. With 16 slots and a
  // 2-slot request this is unreachable in practice, but "unreachable" is exactly the
  // assumption that stops holding when Combinations put eight timbres on the pool.
  if (claimed.length < need) return { indices: [], stolen: [], voiceId: -1 };

  const voiceId = nextVoiceId++;
  claimed.forEach((slotIndex, oscIndex) => {
    const s = slots[slotIndex]!;
    if (stolen.includes(slotIndex) && s.state !== 'free') {
      // Marked for the caller to fade; the slot is re-armed by `commit` once faded, so the
      // engine never has to hard-cut a sounding oscillator.
      s.stealingSince = req.now;
    }
    s.state = 'held';
    s.note = req.note;
    s.channel = req.channel;
    s.timbre = timbre;
    s.voiceId = voiceId;
    s.oscIndex = oscIndex;
    s.startedAt = req.now;
    s.level = 0;
    s.sustained = false;
  });

  return { indices: claimed, stolen: stolen.filter((i) => claimed.includes(i)), voiceId };
}

/**
 * Release every slot of the matching note on the matching channel.
 * Returns the slot indices moved to `released`.
 *
 * Both halves of a DOUBLE release together because they share a note and channel — the
 * shared voiceId is what keeps them in step even if one has already been stolen.
 */
export function noteOff(slots: Slot[], note: number, channel: number, sustainDown: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.state !== 'held' || s.note !== note || s.channel !== channel) continue;
    if (sustainDown) {
      // Pedal is down: keep sounding, but mark it so the allocator knows this one is being
      // held by a pedal rather than a finger and may be stolen sooner.
      s.sustained = true;
    } else {
      s.state = 'released';
    }
    out.push(i);
  }
  return out;
}

/** Release everything the sustain pedal was holding. */
export function sustainUp(slots: Slot[], channel: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.sustained && s.channel === channel) {
      s.sustained = false;
      if (s.state === 'held') s.state = 'released';
      out.push(i);
    }
  }
  return out;
}

/** Mark a slot's envelope as finished; it becomes available again. */
export function freeSlot(slot: Slot): void {
  slot.state = 'free';
  slot.note = -1;
  slot.channel = -1;
  slot.timbre = -1;
  slot.voiceId = -1;
  slot.oscIndex = 0;
  slot.stealingSince = -1;
  slot.level = 0;
  slot.sustained = false;
}

/** Slots currently producing sound. */
export function activeCount(slots: Slot[]): number {
  let n = 0;
  for (const s of slots) if (s.state !== 'free') n++;
  return n;
}

/** How many whole voices are sounding, given each costs `slotsPerVoice`. */
export function voiceCount(slots: Slot[]): number {
  const ids = new Set<number>();
  for (const s of slots) if (s.state !== 'free') ids.add(s.voiceId);
  return ids.size;
}
