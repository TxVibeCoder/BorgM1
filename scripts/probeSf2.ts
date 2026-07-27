/**
 * SF2 probe — a BUILD-TIME diagnostic, not part of the app.
 *
 * Answers the questions the bank builder must not guess at, by measuring the actual file
 * rather than trusting documentation:
 *
 *   1. Is `BasicSample.loopEnd` inclusive or exclusive? spessasynth_core's own docs
 *      contradict each other — the field comment says "exclusive, maximum allowed value is
 *      the sample data length", the constructor's @param says "Inclusive". One of those is
 *      an off-by-one on every looped sample in the bank, which shows up as a faint pitch
 *      error on sustain and nothing else.
 *   2. Are the library's loop points already rebased off `dwStart`? If so the extractor
 *      must NOT rebase again.
 *   3. What sample rates, root keys and loop coverage does FluidR3_GM actually have?
 *
 * Run:  npx tsx scripts/probeSf2.ts [path-to.sf2]
 */

import { readFileSync } from 'node:fs';
import { SoundBankLoader, type BasicSample } from 'spessasynth_core';
import { DEFAULT_SF2_PATH } from './bankConfig.ts';

function loadBank(path: string) {
  const buf = readFileSync(path);
  // Copy into a clean ArrayBuffer — a Node Buffer is a view into a shared pool, and
  // handing its .buffer straight over would expose megabytes of unrelated memory.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return SoundBankLoader.fromArrayBuffer(ab);
}

/**
 * Decide, from the data, whether loopEnd is exclusive — by measuring PERIODICITY.
 *
 * A loop is a claim that the signal repeats with period L. So test that claim directly:
 * the window at `loopStart` should match the window one loop-length later. Whichever
 * candidate L makes them match is the right convention.
 *
 *   exclusive: L = loopEnd - loopStart
 *   inclusive: L = loopEnd - loopStart + 1
 *
 * Comparing single samples either side of the wrap (the obvious first approach) is far too
 * weak: data[loopEnd-1] and data[loopEnd] are one sample apart on a smooth waveform, so
 * whichever happens to sit nearer data[loopStart] in VALUE wins, which says nothing about
 * which one actually precedes it. Periodicity over a whole window is unambiguous, and a
 * one-sample period error puts a visible floor under the match.
 */
function probeLoopEndConvention(samples: BasicSample[]): void {
  let exclusiveWins = 0;
  let inclusiveWins = 0;
  let tied = 0;
  let examined = 0;
  let sumRatio = 0;

  /** Mean absolute difference between two windows, normalized by the signal's own RMS. */
  function windowMismatch(data: Float32Array, a: number, b: number, w: number): number {
    let diff = 0;
    let energy = 0;
    for (let i = 0; i < w; i++) {
      const x = data[a + i]!;
      const y = data[b + i]!;
      diff += Math.abs(x - y);
      energy += Math.abs(x);
    }
    return energy === 0 ? 0 : diff / energy;
  }

  for (const s of samples) {
    const lenExclusive = s.loopEnd - s.loopStart;
    if (lenExclusive < 32) continue;
    let data: Float32Array;
    try {
      data = s.getAudioData();
    } catch {
      continue;
    }

    // Look BACKWARDS from loopStart rather than forwards from it. Under a period of L,
    // data[loopStart - k] == data[loopStart + L - k], so the window just before loopStart
    // must match the window just before loopEnd. That only needs the attack (always
    // present) and one sample past loopEnd — where the forward test needed a whole window
    // past loopEnd, which almost no sample has, hence 14 usable out of 1418.
    const w = Math.min(lenExclusive, s.loopStart, 512);
    if (w < 32) continue;
    if (s.loopEnd + 1 > data.length) continue;
    examined++;

    const exclusiveMismatch = windowMismatch(data, s.loopStart - w, s.loopEnd - w, w);
    const inclusiveMismatch = windowMismatch(data, s.loopStart - w, s.loopEnd + 1 - w, w);
    if (exclusiveMismatch === 0 && inclusiveMismatch === 0) continue;

    const ratio = inclusiveMismatch / Math.max(exclusiveMismatch, 1e-9);
    sumRatio += Math.min(ratio, 10);
    if (Math.abs(exclusiveMismatch - inclusiveMismatch) < 0.02 * exclusiveMismatch) tied++;
    else if (exclusiveMismatch < inclusiveMismatch) exclusiveWins++;
    else inclusiveWins++;
  }

  console.log(`\n--- loopEnd convention: periodicity test (${examined} samples) ---`);
  console.log(`  period L = loopEnd - loopStart      matches better (EXCLUSIVE): ${exclusiveWins}`);
  console.log(`  period L = loopEnd - loopStart + 1  matches better (INCLUSIVE): ${inclusiveWins}`);
  console.log(`  indistinguishable:                                             ${tied}`);
  console.log(`  mean mismatch ratio inclusive/exclusive: ${(sumRatio / Math.max(examined, 1)).toFixed(3)}`);
  console.log(`    (>1 means the exclusive period is the better fit)`);
  const verdict =
    exclusiveWins > inclusiveWins * 2
      ? 'EXCLUSIVE — loop length = loopEnd - loopStart'
      : inclusiveWins > exclusiveWins * 2
        ? 'INCLUSIVE — loop length = loopEnd - loopStart + 1'
        : 'INCONCLUSIVE — inspect by hand before trusting either';
  console.log(`  VERDICT: ${verdict}`);
}

function main(): void {
  const path = process.argv[2] ?? DEFAULT_SF2_PATH;
  console.log(`Loading ${path} ...`);
  const bank = loadBank(path);

  console.log(`\n--- bank ---`);
  console.log(`  type:      ${bank.type}`);
  console.log(`  name:      ${bank.soundBankInfo.name ?? '(none)'}`);
  console.log(`  presets:   ${bank.presets.length}`);
  console.log(`  instruments: ${bank.instruments.length}`);
  console.log(`  samples:   ${bank.samples.length}`);

  const rates = new Map<number, number>();
  const roots = new Set<number>();
  let looped = 0;
  let oversizeLoop = 0;
  let maxLen = 0;
  for (const s of bank.samples) {
    rates.set(s.sampleRate, (rates.get(s.sampleRate) ?? 0) + 1);
    roots.add(s.originalKey);
    if (s.loopEnd > s.loopStart + 1) looped++;
  }
  console.log(`\n--- samples ---`);
  console.log(
    `  rates: ${[...rates.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}Hz x${n}`).join(', ')}`,
  );
  console.log(`  looped: ${looped}/${bank.samples.length}`);
  console.log(`  distinct root keys: ${roots.size}`);

  // Is loopEnd within the data? (the "already rebased?" question — an un-rebased loop
  // point would be an absolute offset into the whole file and land wildly out of range)
  let inRange = 0;
  let outOfRange = 0;
  for (const s of bank.samples.slice(0, 400)) {
    let len: number;
    try {
      len = s.getAudioData().length;
    } catch {
      continue;
    }
    maxLen = Math.max(maxLen, len);
    if (s.loopEnd <= len && s.loopStart >= 0) inRange++;
    else outOfRange++;
    if (s.loopEnd === len) oversizeLoop++;
  }
  console.log(`\n--- loop points already rebased? (first 400 samples) ---`);
  console.log(`  loop region inside the sample: ${inRange}`);
  console.log(`  loop region OUT of range:      ${outOfRange}`);
  console.log(`  loopEnd exactly == length:     ${oversizeLoop}`);
  console.log(
    `  => ${outOfRange === 0 ? 'REBASED by the library. Do NOT subtract dwStart again.' : 'NOT rebased — subtract dwStart.'}`,
  );

  probeLoopEndConvention(bank.samples);

  console.log(`\n--- a few presets ---`);
  for (const p of bank.presets.slice(0, 8)) {
    console.log(`  ${p.bankMSB}:${p.program} ${p.name} (${p.zones.length} zones)`);
  }
}

main();
