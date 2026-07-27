/**
 * Seeded PRNG. CLAUDE.md: deterministic pure code — never `Math.random` in a pure
 * core. Randomness lives in the impure shell and is passed in as an argument, so
 * every core that needs noise takes a `() => number` and the caller decides whether
 * it is seeded (tests, golden buffers) or entropic (runtime).
 *
 * mulberry32: 32-bit state, ~2^32 period, passes gjrand — plenty for noise beds and
 * humanize jitter, and cheap enough to call per sample.
 */

/** Build a deterministic [0, 1) generator from a uint32 seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
