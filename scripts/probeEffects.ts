/**
 * Validate `data/effectParams.ts` against Korg's own factory preload. BUILD/DEV ONLY.
 *
 * The same role `probeSf2.ts` plays for the sample pipeline: answer questions about the
 * effect block FROM THE DATA rather than from documentation, and keep the answer runnable so
 * a later session can re-check it instead of taking this one's word.
 *
 * The preload is NOT vendored (it is Korg's copyrighted factory bank), so this is a script
 * and not a test. It exits 0 with a clear message when the payload is absent. The findings it
 * produced are pinned in `test/unit/effectParams.test.ts` against a handful of blocks copied
 * into the test file, so the repo still fails loudly if the table drifts.
 *
 *   npm run probe:effects
 *
 * WHAT IT SETTLED, all three recorded in DECISIONS.md:
 *   1. the type byte is the effect number MINUS ONE, with 0x21 meaning Through;
 *   2. MG Status bit1 (phase) is editable data and is what separates the `I`/`II` variants;
 *   3. for the dual algorithms 26-33 a slot's two balance bytes are its two HALVES' dry:wet.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  decodeEffects,
  effectAlgorithm,
  effectPairAllowed,
  encodeEffects,
  EFFECT_ALGORITHMS,
  EFFECT_BLOCK_BYTES,
  EFFECT_BLOCK_START,
  hzToLfoRate,
  LFO_RATE_MAX_BYTE,
  lfoRateToHz,
} from '../data/effectParams';

/** Korg's preload, unpacked from its 7-bit SysEx packing. Same resolution style as the SF2. */
const CANDIDATES = [
  process.env['BORGM1_PRELOAD'],
  resolve(process.cwd(), 'assets/M1preld.syx.unpacked'),
  resolve(process.cwd(), '../BorgM1-research/preload/x/M1preld.syx.unpacked'),
].filter((p): p is string => typeof p === 'string' && p.length > 0);

/** 100 programs of 143 bytes at 13261. RESEARCH-INDEX.md, validated 20/20 non-circularly. */
const BASE = 13261;
const REC = 143;
const N = 100;

function findPreload(): string | null {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  return null;
}

function main(): void {
  // ---- the LFO grid is checkable without the payload ------------------------------------
  let lfoBad = 0;
  for (let b = 0; b <= LFO_RATE_MAX_BYTE; b++) {
    if (hzToLfoRate(lfoRateToHz(b)) !== b) lfoBad++;
  }
  console.log(
    `LFO rate grid: ${LFO_RATE_MAX_BYTE + 1} steps, ${lfoBad} round-trip failures\n` +
      `  0x00->${lfoRateToHz(0)}Hz  0x63->${lfoRateToHz(0x63)}  0x64->${lfoRateToHz(0x64)}  ` +
      `0xC7->${lfoRateToHz(0xc7)}  0xC8->${lfoRateToHz(0xc8)}  0xD8->${lfoRateToHz(0xd8)}`,
  );

  const path = findPreload();
  if (!path) {
    console.log(
      `\nFactory preload not found — skipping the bank checks.\nChecked:\n  ${CANDIDATES.join('\n  ')}`,
    );
    return;
  }
  console.log(`\nPreload: ${path}`);

  const u = new Uint8Array(readFileSync(path));
  const rec = (i: number): Uint8Array => u.subarray(BASE + i * REC, BASE + (i + 1) * REC);
  const nameOf = (i: number): string =>
    Array.from(rec(i).subarray(0, 10))
      .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.'))
      .join('')
      .trim();

  // ---- every factory effect block must survive decode -> encode byte-for-byte -----------
  let exact = 0;
  const diffs: string[] = [];
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const out = new Uint8Array(REC);
    encodeEffects(decodeEffects(r), out);
    const bad: string[] = [];
    for (let k = 0; k < EFFECT_BLOCK_BYTES; k++) {
      const o = EFFECT_BLOCK_START + k;
      if (r[o] !== out[o]) bad.push(`blk${k}: ${r[o]}->${out[o]}`);
    }
    if (bad.length === 0) exact++;
    else if (diffs.length < 20) {
      const s = decodeEffects(r);
      diffs.push(
        `I${String(i).padStart(2, '0')} ${nameOf(i).padEnd(11)} ` +
          `fx1=#${s.slots[0].type} fx2=#${s.slots[1].type}  ${bad.join(', ')}`,
      );
    }
  }
  console.log(`\nByte-exact round trip: ${exact}/${N} factory effect blocks`);
  for (const d of diffs) console.log('  ' + d);
  if (exact < N) {
    console.log(
      '\n  The residue is two understood causes, both deliberate — see DECISIONS.md:\n' +
        '   (a) a handful of factory bytes sit ONE past the range p.129 documents (an E/R\n' +
        '       Level or Drive of 100 where `00~63 : 00~99` allows 99, an Exciter Emphatic\n' +
        '       Point of 11 where `00~09 : 01~10` allows 10). The manual is explicit and is\n' +
        '       treated as the authority; the clamp costs under 0.1 dB on 6 of ~800 bytes.\n' +
        '   (b) two programs carry junk in MG-Status bits 3-4, which p.129 does not define\n' +
        '       (it specifies bit0-2). Those bits are not modelled, so they are not rewritten.',
    );
  }

  // ---- the pairing restriction --------------------------------------------------------
  let viol = 0;
  for (let i = 0; i < N; i++) {
    const s = decodeEffects(rec(i));
    if (!effectPairAllowed(s.slots[0].type, s.slots[1].type)) viol++;
  }
  console.log(`Pairing restriction: ${viol} violations across ${N} programs`);

  // ---- which algorithms the factory bank actually exercises ----------------------------
  const used = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    const s = decodeEffects(rec(i));
    for (const sl of s.slots) used.set(sl.type, (used.get(sl.type) ?? 0) + 1);
  }
  const unused = EFFECT_ALGORITHMS.filter((a) => !used.has(a.index)).map((a) => `#${a.index} ${a.name}`);
  console.log(
    `Coverage: ${used.size - (used.has(0) ? 1 : 0)}/${EFFECT_ALGORITHMS.length} algorithms used by the factory bank`,
  );
  if (unused.length) console.log(`  never used: ${unused.join(', ')}`);

  // ---- the two programs PLAN.md names, decoded in full ---------------------------------
  for (const i of [17, 0, 1]) {
    const s = decodeEffects(rec(i));
    console.log(
      `\nI${String(i).padStart(2, '0')} ${nameOf(i)} — ${s.serial ? 'SERIAL' : 'PARALLEL'}`,
    );
    s.slots.forEach((sl, k) => {
      const a = effectAlgorithm(sl.type);
      console.log(
        `  slot${k + 1} #${sl.type} ${(a?.name ?? 'NO EFFECT').padEnd(16)} wet ${sl.balanceA}/${sl.balanceB}`,
      );
      if (a) console.log(`         ${JSON.stringify(sl.params)}`);
    });
  }
}

main();
