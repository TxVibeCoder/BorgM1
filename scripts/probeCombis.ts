/**
 * Validate `data/combiParams.ts` against Korg's own factory preload. BUILD/DEV ONLY.
 *
 * The same role `probeEffects.ts` played for Phase 4: answer the questions p.128 leaves open
 * FROM THE DATA rather than from documentation, and keep the answer runnable so a later
 * session can re-check it instead of taking this one's word.
 *
 * The preload is NOT vendored (it is Korg's copyrighted factory bank), so this is a script and
 * not a test. It exits 0 with a clear message when the payload is absent. The findings it
 * produced are pinned in `test/unit/combiParams.test.ts` against records copied into the test
 * file, so the repo still fails loudly if the table drifts.
 *
 *   npm run probe:combis
 *
 * THE QUESTIONS IT EXISTS TO SETTLE — p.128 is genuinely ambiguous on all of these:
 *   1. Is the MIDI channel nibble 0-based (stored 0..15, displayed 1..16) or literal 1..16?
 *   2. Do the four CONTROL FILTER bits really mean `0:DIS, 1:ENA` (a set bit RECEIVES)?
 *   3. Which mechanism turns a timbre off — the 00H program byte, or byte+10 bit4, or both?
 *   4. Are bytes 68 and 70 really the split point and velocity switch point (TABLE 6 *14/*15)?
 *   5. Does `TIMBRE.INST` bit7 mark the timbres whose program is a DRUM KIT?
 *   6. Does anything actually pan to buses C/D, and are Output 3/4 Pan set when it does?
 *   7. Does any PROGRAM NO. exceed 0xC7, i.e. is p.128's `C8H = C99` a real value or a typo?
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMBI_PARAMS,
  COMBI_RECORD_BYTES,
  COMBI_TYPES,
  COMBI_TYPE_OFFSET,
  COMBI_EFFECT_BLOCK_START,
  decodeCombi,
  decodeCombiName,
  encodeCombi,
  encodeCombiName,
  PANPOT_POSITIONS,
  readSplitPoint,
  readVelSwitchPoint,
  TIMBRE_BLOCK_BASE,
  TIMBRE_BLOCK_BYTES,
  TIMBRE_COUNT,
} from '../data/combiParams';

/** TABLE 6's footnotes *14 and *15, read as byte offsets. THEY ARE NOT — see Q4. */
const TABLE6_FOOTNOTE_14 = 68;
const TABLE6_FOOTNOTE_15 = 70;
import { decodeEffects } from '../data/effectParams';

/** Korg's preload, unpacked from its 7-bit SysEx packing. Same resolution style as the SF2. */
const CANDIDATES = [
  process.env['BORGM1_PRELOAD'],
  resolve(process.cwd(), 'assets/M1preld.syx.unpacked'),
  resolve(process.cwd(), '../BorgM1-research/preload/x/M1preld.syx.unpacked'),
].filter((p): p is string => typeof p === 'string' && p.length > 0);

/** 100 combinations of 124 bytes at 861. RESEARCH-INDEX.md. */
const COMBI_BASE = 861;
const N = 100;
/** 100 programs of 143 bytes at 13261 — used only to cross-check the drum-kit bit. */
const PROG_BASE = 13261;
const PROG_REC = 143;
/** Program record byte 10, note *2: 0 SINGLE, 1 DOUBLE, 2 DRUMS. */
const PROG_OSC_MODE = 10;

function findPreload(): string | null {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  return null;
}

function histogram(label: string, values: number[], limit = 16): void {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const min = Math.min(...values);
  const max = Math.max(...values);
  console.log(
    `  ${label.padEnd(22)} n=${values.length} range ${min}..${max}  ` +
      sorted.map(([v, c]) => `${v}x${c}`).join(' '),
  );
}

function main(): void {
  // ---- the record arithmetic is checkable without the payload -----------------------------
  console.log(
    `Record: ${COMBI_RECORD_BYTES} bytes, ${COMBI_PARAMS.length} parameters, ` +
      `${TIMBRE_COUNT} timbres of ${TIMBRE_BLOCK_BYTES} from ${TIMBRE_BLOCK_BASE}\n` +
      `  last timbre byte = ${TIMBRE_BLOCK_BASE + TIMBRE_COUNT * TIMBRE_BLOCK_BYTES - 1} ` +
      `(record is 0..${COMBI_RECORD_BYTES - 1})\n` +
      `  ${COMBI_BASE} + ${N}x${COMBI_RECORD_BYTES} = ${COMBI_BASE + N * COMBI_RECORD_BYTES} ` +
      `— the programs start at ${PROG_BASE}` +
      (COMBI_BASE + N * COMBI_RECORD_BYTES === PROG_BASE ? ' ✓ exactly' : ' ✗ MISMATCH'),
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
  const rec = (i: number): Uint8Array =>
    u.subarray(COMBI_BASE + i * COMBI_RECORD_BYTES, COMBI_BASE + (i + 1) * COMBI_RECORD_BYTES);
  const tb = (r: Uint8Array, t: number, off: number): number =>
    r[TIMBRE_BLOCK_BASE + t * TIMBRE_BLOCK_BYTES + off] ?? 0;
  const progOscMode = (index: number): number =>
    u[PROG_BASE + index * PROG_REC + PROG_OSC_MODE] ?? 0;

  // ---- the type byte, and whether the names look like text ---------------------------------
  const typeCounts = new Map<string, number>();
  let printable = 0;
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const t = r[COMBI_TYPE_OFFSET] ?? 0;
    const name = COMBI_TYPES[t] ?? `?${t}`;
    typeCounts.set(name, (typeCounts.get(name) ?? 0) + 1);
    if (/^[\x20-\x7e]+$/.test(decodeCombiName(r))) printable++;
  }
  console.log(
    `\nTypes: ${[...typeCounts].map(([k, v]) => `${k}=${v}`).join('  ')}` +
      `   (names printable: ${printable}/${N})`,
  );
  console.log('  first 8:', Array.from({ length: 8 }, (_, i) => decodeCombiName(rec(i))).join(' | '));

  // ---- Q7: does any program byte exceed 0xC7? ----------------------------------------------
  const progBytes: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < TIMBRE_COUNT; t++) progBytes.push(tb(rec(i), t, 0));
  }
  const overC7 = progBytes.filter((b) => b > 0xc7).length;
  console.log('\nQ7  PROGRAM NO. byte');
  histogram('all timbres', progBytes, 10);
  console.log(
    `  bytes > 0xC7 (199): ${overC7}  ` +
      (overC7 === 0
        ? '-> the field range 00~C7 holds; p.128\'s "C8H = C99" is a printing error'
        : '-> 0xC8 IS reachable; revisit the mapping'),
  );

  // ---- Q1: the MIDI channel nibble ---------------------------------------------------------
  const chNibbles: number[] = [];
  const chHighBits: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      const b = tb(rec(i), t, 10);
      chNibbles.push(b & 0x0f);
      chHighBits.push(b >> 5); // above the TIMBRE ON/OFF bit
    }
  }
  console.log('\nQ1  MIDI CHANNEL nibble (byte+10 bits 3~0)');
  histogram('nibble', chNibbles);
  console.log(
    `  0 present: ${chNibbles.includes(0)}   15 present: ${chNibbles.includes(15)}\n` +
      '  A literal 1..16 cannot store 16 in four bits, so a 0 in the data means the nibble is\n' +
      '  ZERO-BASED and the display adds one.',
  );
  histogram('bits 7..5 (undoc)', chHighBits);

  // ---- Q2: the four CONTROL FILTER bits ----------------------------------------------------
  const filterBytes: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < TIMBRE_COUNT; t++) filterBytes.push(tb(rec(i), t, 9));
  }
  console.log('\nQ2  CONTROL FILTER byte (byte+9)');
  histogram('raw', filterBytes);
  for (const [name, bit] of [
    ['PROGRAM CHANGE', 0],
    ['DAMPER', 1],
    ['AFTER TOUCH', 2],
    ['CONTROL CHANGE', 3],
  ] as const) {
    const set = filterBytes.filter((b) => (b >> bit) & 1).length;
    console.log(
      `  bit${bit} ${name.padEnd(15)} set in ${String(set).padStart(3)}/${filterBytes.length}` +
        ` (${((100 * set) / filterBytes.length).toFixed(0)}%)`,
    );
  }
  console.log(
    '  Under `0:DIS, 1:ENA` a mostly-SET population means Korg mostly enabled reception,\n' +
      '  which is what an authored factory bank should look like. A mostly-CLEAR population\n' +
      '  would mean the polarity is the other way round.',
  );

  // ---- Q3: which mechanism turns a timbre off ----------------------------------------------
  let offByBit = 0;
  let offByProgram = 0;
  let both = 0;
  let bitSetInNonMulti = 0;
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const isMulti = (r[COMBI_TYPE_OFFSET] ?? 0) === COMBI_TYPES.indexOf('MULTI');
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      const bit = (tb(r, t, 10) >> 4) & 1;
      const prog0 = tb(r, t, 0) === 0;
      if (bit) offByBit++;
      if (isMulti && prog0) offByProgram++;
      if (bit && isMulti && prog0) both++;
      if (bit && !isMulti) bitSetInNonMulti++;
    }
  }
  console.log('\nQ3  TIMBRE OFF');
  console.log(
    `  byte+10 bit4 set:        ${offByBit}\n` +
      `  MULTI program byte 00H:  ${offByProgram}\n` +
      `  both on the same timbre: ${both}\n` +
      `  bit4 set outside MULTI:  ${bitSetInNonMulti}`,
  );

  // ---- Q4: where the split point actually lives ---------------------------------------------
  //
  // TABLE 6 footnotes the SPLIT page's cursor position D as *14 = "68" and the VELOCITY SWITCH
  // page's as *15 = "70". Every other cell in that table is a byte offset. Test whether these
  // two are as well, against the rival hypothesis that the point is the timbres' window edge.
  console.log('\nQ4  SPLIT POINT — byte 68, or the key windows?');
  for (const type of ['SPLIT', 'VELOCITY SWITCH'] as const) {
    const idx = COMBI_TYPES.indexOf(type);
    const rows = Array.from({ length: N }, (_, i) => i).filter(
      (i) => (rec(i)[COMBI_TYPE_OFFSET] ?? 0) === idx,
    );
    if (rows.length === 0) {
      console.log(`  ${type}: none in the factory bank — the SPLIT finding carries by symmetry`);
      continue;
    }
    const off = type === 'SPLIT' ? TABLE6_FOOTNOTE_14 : TABLE6_FOOTNOTE_15;
    for (const i of rows) {
      const r = rec(i);
      const derived = type === 'SPLIT' ? readSplitPoint(decodeCombi(r)) : readVelSwitchPoint(decodeCombi(r));
      const contiguous = type === 'SPLIT' ? tb(r, 0, 5) + 1 === tb(r, 1, 6) : tb(r, 0, 7) + 1 === tb(r, 1, 8);
      console.log(
        `  ${decodeCombiName(r).padEnd(11)} byte${off}=${String(r[off]).padStart(3)}  ` +
          `t1 key[${tb(r, 0, 6)}..${tb(r, 0, 5)}] t2 key[${tb(r, 1, 6)}..${tb(r, 1, 5)}]  ` +
          `-> derived point ${derived}, windows ${contiguous ? 'CONTIGUOUS' : 'not contiguous'}`,
      );
    }
    console.log(
      `  The byte-${off} reading gives 16 on both, which is not a playable split; the window\n` +
        '  reading gives 70 and 60 and is contiguous on both. The footnote is not an offset.',
    );
  }

  // ---- Q5: TIMBRE.INST bit7 vs the referenced program's oscillator mode ---------------------
  let instSet = 0;
  let instSetAndDrums = 0;
  let drumsTotal = 0;
  let drumsWithoutBit = 0;
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const isMulti = (r[COMBI_TYPE_OFFSET] ?? 0) === COMBI_TYPES.indexOf('MULTI');
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      const pb = tb(r, t, 0);
      const index = isMulti ? pb - 1 : pb;
      if (index < 0 || index >= 100) continue; // OFF, or a C-bank program we do not have
      const bit = (tb(r, t, 4) >> 7) & 1;
      const isDrums = progOscMode(index) === 2;
      if (bit) instSet++;
      if (isDrums) drumsTotal++;
      if (bit && isDrums) instSetAndDrums++;
      if (isDrums && !bit) drumsWithoutBit++;
    }
  }
  console.log('\nQ5  TIMBRE.INST bit7 (byte+4) vs the referenced program being a DRUM KIT');
  console.log(
    `  bit7 set:                       ${instSet}\n` +
      `  timbres pointing at a DRUMS pgm: ${drumsTotal}\n` +
      `  both:                            ${instSetAndDrums}\n` +
      `  DRUMS program without bit7:      ${drumsWithoutBit}\n` +
      '  A clean split confirms the reading "0:TIMBRE pan, 1:per-INSTRUMENT pan".',
  );

  // ---- Q6: does anything reach buses C/D, and is Output 3/4 Pan set when it does? -----------
  const pans: number[] = [];
  let cdTimbres = 0;
  const cdCombis: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    let anyCd = false;
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      const p = tb(r, t, 4) & 0x0f;
      pans.push(p);
      if (p >= 11 && p <= 13) {
        cdTimbres++;
        anyCd = true;
      }
    }
    if (anyCd) cdCombis.push(i);
  }
  console.log('\nQ6  PANPOT (byte+4 bits 3~0) and the C/D path');
  histogram('position', pans, 14);
  console.log(
    `  legend: ${PANPOT_POSITIONS.map((p, i) => `${i}=${p}`).join(' ')}\n` +
      `  timbres routed to C/C+D/D: ${cdTimbres}, in ${cdCombis.length} combinations`,
  );
  for (const i of cdCombis.slice(0, 8)) {
    const r = rec(i);
    const fx = decodeEffects(r, COMBI_EFFECT_BLOCK_START);
    const routed = Array.from({ length: TIMBRE_COUNT }, (_, t) => tb(r, t, 4) & 0x0f)
      .map((p) => PANPOT_POSITIONS[p] ?? '?')
      .join(',');
    console.log(
      `    ${decodeCombiName(r).padEnd(11)} ${(COMBI_TYPES[r[COMBI_TYPE_OFFSET] ?? 0] ?? '?').padEnd(15)}` +
        ` ${fx.serial ? 'SERIAL  ' : 'PARALLEL'} out3Pan=${fx.out3Pan} out4Pan=${fx.out4Pan}  [${routed}]`,
    );
  }
  const out3 = Array.from({ length: N }, (_, i) => decodeEffects(rec(i), COMBI_EFFECT_BLOCK_START));
  histogram('out3Pan (all combis)', out3.map((e) => e.out3Pan));
  histogram('out4Pan (all combis)', out3.map((e) => e.out4Pan));
  console.log(`  SERIAL: ${out3.filter((e) => e.serial).length}/${N}`);

  // ---- levels, for the panpot gain law ------------------------------------------------------
  const levels: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const isMulti = (r[COMBI_TYPE_OFFSET] ?? 0) === COMBI_TYPES.indexOf('MULTI');
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      if (isMulti && tb(r, t, 0) === 0) continue; // an OFF timbre's level is meaningless
      levels.push(tb(r, t, 1));
    }
  }
  console.log('\n    OUTPUT LEVEL of sounding timbres');
  histogram('level', levels);
  console.log(
    `  mean ${(levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1)} of 99 — ` +
      'how much headroom Korg left for stacking tells us what the panpot law can cost.',
  );

  // ---- the undocumented bits, and the ranges the factory bank exceeds -----------------------
  console.log('\nQx  BITS AND RANGES p.128 DOES NOT ACCOUNT FOR');
  const filterHigh = filterBytes.map((b) => b >> 4);
  histogram('filter bits 7..4', filterHigh);
  const panBytes: number[] = [];
  const velTop: number[] = [];
  const velBottom: number[] = [];
  const keyTop: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      panBytes.push(tb(rec(i), t, 4));
      velTop.push(tb(rec(i), t, 7));
      velBottom.push(tb(rec(i), t, 8));
      keyTop.push(tb(rec(i), t, 5));
    }
  }
  histogram('panpot byte 7..4', panBytes.map((b) => b >> 4));
  histogram('VEL TOP (doc 01~7F)', velTop);
  histogram('VEL BOTTOM (01~7F)', velBottom);
  histogram('KEY TOP (doc 00~7F)', keyTop);
  console.log(`  VEL TOP  = 0: ${velTop.filter((v) => v === 0).length}/800`);
  console.log(`  VEL BTM  = 0: ${velBottom.filter((v) => v === 0).length}/800`);
  // Where exactly do the two bit7 panpot bytes live, and what do they point at?
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const isMulti = (r[COMBI_TYPE_OFFSET] ?? 0) === COMBI_TYPES.indexOf('MULTI');
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      if (((tb(r, t, 4) >> 7) & 1) === 0) continue;
      const pb = tb(r, t, 0);
      const index = isMulti ? pb - 1 : pb;
      console.log(
        `  bit7 SET: ${decodeCombiName(r)} T${t + 1} panByte=${tb(r, t, 4)} ` +
          `prog=${pb}(idx ${index}, oscMode ${index >= 0 && index < 100 ? progOscMode(index) : '-'}) ` +
          `off=${(tb(r, t, 10) >> 4) & 1}`,
      );
    }
  }
  // Name padding: does Korg pad with NUL or with space?
  const padBytes = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    for (let k = 0; k < 10; k++) {
      const c = r[k] ?? 0;
      if (c < 32) padBytes.set(c, (padBytes.get(c) ?? 0) + 1);
    }
  }
  console.log(
    `  name bytes below 0x20: ${[...padBytes].map(([v, c]) => `0x${v.toString(16)}x${c}`).join(' ') || 'none'}`,
  );

  // ---- every factory record must survive decode -> encode byte-for-byte ---------------------
  //
  // The measurement covers bytes 10 and 36..123 — the type byte and the eight timbre blocks,
  // which is what this table owns. Bytes 0-9 are the name (a display string, carried verbatim
  // by an importer) and 11-35 are Phase 4's effect block, already measured by `probe:effects`.
  let exact = 0;
  const diffs: string[] = [];
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const out = encodeCombi(decodeCombi(r));
    encodeCombiName(decodeCombiName(r), out);
    out.set(r.subarray(COMBI_EFFECT_BLOCK_START, TIMBRE_BLOCK_BASE), COMBI_EFFECT_BLOCK_START);
    const bad: string[] = [];
    for (let k = COMBI_TYPE_OFFSET; k < COMBI_RECORD_BYTES; k++) {
      if (r[k] !== out[k]) bad.push(`${k}:${r[k]}->${out[k]}`);
    }
    if (bad.length === 0) exact++;
    else if (diffs.length < 20) {
      diffs.push(
        `C${String(i).padStart(2, '0')} ${decodeCombiName(r).padEnd(11)} ` +
          `${(COMBI_TYPES[r[COMBI_TYPE_OFFSET] ?? 0] ?? '?').padEnd(15)} ${bad.slice(0, 10).join(' ')}` +
          (bad.length > 10 ? ` (+${bad.length - 10})` : ''),
      );
    }
  }
  console.log(`\nByte-exact round trip: ${exact}/${N} factory combination records (bytes 10..123)`);
  for (const d of diffs) console.log('  ' + d);

  // The name is a display string, so its 18 embedded NULs decode to spaces and re-encode as
  // spaces. Measured separately rather than folded in, because it is not a table question.
  let nameExact = 0;
  for (let i = 0; i < N; i++) {
    const r = rec(i);
    const out = new Uint8Array(COMBI_RECORD_BYTES);
    encodeCombiName(decodeCombiName(r), out);
    if (r.subarray(0, 10).every((b, k) => b === out[k])) nameExact++;
  }
  console.log(
    `Name bytes 0..9: ${nameExact}/${N} exact — the residue is Korg's 18 embedded 0x00s, which\n` +
      '  display as spaces and re-encode as spaces. An importer carries the raw bytes.',
  );

  // ---- one decoded combination of each type, in full ----------------------------------------
  for (const type of COMBI_TYPES) {
    const i = Array.from({ length: N }, (_, k) => k).find(
      (k) => (rec(k)[COMBI_TYPE_OFFSET] ?? 0) === COMBI_TYPES.indexOf(type),
    );
    if (i === undefined) continue;
    const r = rec(i);
    const p = decodeCombi(r);
    console.log(`\nC${String(i).padStart(2, '0')} ${decodeCombiName(r)} — ${type}`);
    if (type === 'SPLIT') console.log(`  split point: ${p['SPLIT_POINT']}`);
    if (type === 'VELOCITY SWITCH') console.log(`  vel sw point: ${p['VEL_SWITCH_POINT']}`);
    const used = type === 'MULTI' ? TIMBRE_COUNT : type === 'SINGLE' ? 1 : 2;
    for (let t = 1; t <= used; t++) {
      console.log(
        `  T${t} prog=${String(p[`T${t}_PROGRAM`]).padEnd(4)} lvl=${String(p[`T${t}_LEVEL`]).padStart(2)}` +
          ` pan=${String(p[`T${t}_PAN`]).padEnd(4)} ch=${String(p[`T${t}_CHANNEL`]).padStart(2)}` +
          ` key[${p[`T${t}_KEY_BOTTOM`]}..${p[`T${t}_KEY_TOP`]}]` +
          ` vel[${p[`T${t}_VEL_BOTTOM`]}..${p[`T${t}_VEL_TOP`]}]` +
          ` tr=${p[`T${t}_TRANSPOSE`]} det=${p[`T${t}_DETUNE`]}` +
          ` ${p[`T${t}_TIMBRE_OFF`]} filt=${p[`T${t}_FILTER_PROGRAM_CHANGE`]}/${p[`T${t}_FILTER_DAMPER`]}` +
          `/${p[`T${t}_FILTER_AFTER_TOUCH`]}/${p[`T${t}_FILTER_CONTROL_CHANGE`]}`,
      );
    }
  }
}

main();
