/**
 * THE bank builder. One command:  npm run build:bank
 *
 * Turns FluidR3_GM (MIT) plus additively-rendered DWGS tables into BorgM1's sample bank.
 * Build-time only — this runs in Node, writes to public/bank/, and nothing in src/ imports
 * it. The app loads the OUTPUT, never the 141 MB SoundFont.
 *
 * OUTPUT SHAPE — one blob, not hundreds of files:
 *   public/bank/bank.pcm    every sample's Int16LE data, concatenated
 *   public/bank/bank.json   the keymap: multisounds, drums, and each sample's
 *                           byte offset/length, loop points, root key and tuning
 *
 * A single blob because the factory bank belongs in the Cache API, and one cache entry
 * fetched once beats ~600 conditional requests. The JSON is small enough to parse eagerly;
 * the PCM is sliced by offset at load.
 *
 * ZONES ARE INHERITED, NOT INVENTED. For each source preset the builder walks all 128 keys
 * asking the SoundFont which sample would sound, and groups runs of keys that answer the
 * same. That reproduces FluidR3's own zone structure exactly (typically 9 zones per
 * instrument) rather than guessing boundaries — and denser key zones are precisely where
 * the absent 1988 size ceiling is worth spending, because keeping the pitch ratio near 1.0
 * matters more than interpolation quality.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SoundBankLoader, type BasicPreset, type BasicSample } from 'spessasynth_core';
import { BANK_OUT_DIR, resolveSf2Path } from './bankConfig.ts';
import { DRUM_SOUNDS, MULTISOUNDS } from '../data/sounds.ts';
import { DRUM_SOURCES, MULTISOUND_SOURCES } from '../data/sourceMap.ts';
import { bakeSample, DEFAULT_BANK_RATE } from '../src/engine/sample/bakeCore.ts';
import { DWGS_RECIPES, DWGS_ROOT_FINE_CENTS, DWGS_ROOT_KEY, renderRecipe } from '../src/engine/sample/dwgsCore.ts';
import { floatToInt16, int16ToFloat } from '../src/engine/sample/pcmCore.ts';
import { loopSeamDiscontinuity } from '../src/engine/sample/loopCore.ts';

/**
 * Maximum acceptable wrap discontinuity, in units of the sample's own steepest local step
 * (see loopSeamDiscontinuity). A perfect loop scores ~1 because the wrap still advances
 * one sample; 2 leaves headroom for that without admitting an audible step.
 */
const SEAM_LIMIT = 2;

// SF2 generator indices we read off a resolved voice.
const GEN_OVERRIDING_ROOT_KEY = 58;
const GEN_FINE_TUNE = 52;
const GEN_COARSE_TUNE = 51;

/** Velocity used when resolving zones. Multisounds have no velocity layers by design. */
const PROBE_VELOCITY = 100;

interface BankSample {
  id: string;
  /** Byte offset into bank.pcm. */
  byteOffset: number;
  /** Length in SAMPLES (not bytes). */
  length: number;
  sampleRate: number;
  loopStart: number;
  loopEnd: number;
  rootKey: number;
  /** Total detune in cents, coarse + fine, to apply on playback. */
  fineCents: number;
}

interface KeyZone {
  keyLow: number;
  keyHigh: number;
  sampleId: string;
}

interface MultisoundEntry {
  index: number;
  name: string;
  tracking: boolean;
  synthesized: boolean;
  /** Present only when this sound reuses another's audio (the NT variants). */
  sharesSampleWith: number | null;
  source: string;
  approx: boolean;
  zones: KeyZone[];
}

interface DrumEntry {
  index: number;
  name: string;
  source: string;
  approx: boolean;
  sampleId: string;
}

function loadBank(path: string) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return SoundBankLoader.fromArrayBuffer(ab);
}

/** Resolve one (preset, key) to its sample and tuning, or null if nothing sounds there. */
function resolveVoice(preset: BasicPreset, key: number) {
  let params;
  try {
    params = preset.getVoiceParameters(key, PROBE_VELOCITY);
  } catch {
    return null;
  }
  if (!params || params.length === 0) return null;
  // Take the first layer. A GM preset can stack layers; the M1's multisound model has no
  // equivalent (velocity and layering live at Program/Combi level), so flattening to one
  // is the correct translation rather than a shortcut.
  const v = params[0]!;
  const g = v.generators;
  const rootOverride = g[GEN_OVERRIDING_ROOT_KEY] ?? -1;
  const rootKey = rootOverride >= 0 && rootOverride <= 127 ? rootOverride : v.sample.originalKey;
  const cents = (g[GEN_COARSE_TUNE] ?? 0) * 100 + (g[GEN_FINE_TUNE] ?? 0) + v.sample.pitchCorrection;
  return { sample: v.sample, rootKey, cents };
}

class BlobWriter {
  private chunks: Int16Array[] = [];
  private samples = 0;
  readonly index = new Map<string, BankSample>();

  /** Append a baked sample under `id`, deduplicating identical ids. */
  add(
    id: string,
    pcm: Int16Array,
    meta: { sampleRate: number; loopStart: number; loopEnd: number; rootKey: number; fineCents: number },
  ): BankSample {
    const existing = this.index.get(id);
    if (existing) return existing;
    const entry: BankSample = {
      id,
      byteOffset: this.samples * 2,
      length: pcm.length,
      ...meta,
    };
    this.chunks.push(pcm);
    this.samples += pcm.length;
    this.index.set(id, entry);
    return entry;
  }

  toBuffer(): Buffer {
    const all = new Int16Array(this.samples);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    // Int16Array is little-endian on every platform Node runs on that we target; assert
    // rather than assume, because a silently byte-swapped bank sounds like white noise.
    const buf = Buffer.from(all.buffer, all.byteOffset, all.byteLength);
    return buf;
  }

  get totalSamples(): number {
    return this.samples;
  }
}

function main(): void {
  const sf2Path = resolveSf2Path();
  console.log(`SF2:  ${sf2Path}`);
  const sf = loadBank(sf2Path);
  console.log(`      ${sf.presets.length} presets, ${sf.samples.length} samples`);

  const melodic = new Map<number, BasicPreset>();
  const drumKits = new Map<number, BasicPreset>();
  for (const p of sf.presets) {
    if (p.isDrum) {
      if (!drumKits.has(p.program)) drumKits.set(p.program, p);
    } else if (!melodic.has(p.program)) melodic.set(p.program, p);
  }

  const blob = new BlobWriter();
  const multisounds: MultisoundEntry[] = [];
  const drums: DrumEntry[] = [];
  const warnings: string[] = [];

  // ---- 1. synthesized multisounds (77..99) ------------------------------------------
  const dwgsById = new Map<number, string>();
  for (const recipe of DWGS_RECIPES) {
    const r = renderRecipe(recipe);
    const id = `dwgs-${r.index}`;
    // No baking: the table IS one exact period, so it is already at the bank rate, needs
    // no resampling, and its loop is seamless by construction. Running it through
    // bakeSample would resample a 256-sample table for no reason and could only lose.
    blob.add(id, floatToInt16(r.data), {
      sampleRate: DEFAULT_BANK_RATE,
      loopStart: r.loopStart,
      loopEnd: r.loopEnd,
      rootKey: DWGS_ROOT_KEY,
      fineCents: DWGS_ROOT_FINE_CENTS,
    });
    dwgsById.set(r.index, id);
  }

  // ---- 2. sourced multisounds --------------------------------------------------------
  /** multisound index -> its zones, so NT variants can copy their sibling's. */
  const zonesByIndex = new Map<number, KeyZone[]>();

  for (const ms of MULTISOUNDS) {
    if (ms.synthesized) {
      const id = dwgsById.get(ms.index)!;
      const zones: KeyZone[] = [{ keyLow: 0, keyHigh: 127, sampleId: id }];
      zonesByIndex.set(ms.index, zones);
      multisounds.push({
        index: ms.index,
        name: ms.name,
        tracking: ms.tracking,
        synthesized: true,
        sharesSampleWith: null,
        source: 'DWGS additive (rendered)',
        approx: !DWGS_RECIPES.find((r) => r.index === ms.index)?.exact,
        zones,
      });
      continue;
    }

    // NT variants reuse their tracked sibling's zones verbatim.
    if (ms.sharesSampleWith !== null) {
      const sibling = zonesByIndex.get(ms.sharesSampleWith);
      if (!sibling) {
        warnings.push(`${ms.index} ${ms.name}: sibling ${ms.sharesSampleWith} not built yet`);
        continue;
      }
      multisounds.push({
        index: ms.index,
        name: ms.name,
        tracking: false,
        synthesized: false,
        sharesSampleWith: ms.sharesSampleWith,
        source: `shares ${ms.sharesSampleWith}`,
        approx: false,
        zones: sibling,
      });
      continue;
    }

    const src = MULTISOUND_SOURCES[ms.index];
    if (!src) {
      warnings.push(`${ms.index} ${ms.name}: NO SOURCE MAPPED`);
      continue;
    }
    const preset = melodic.get(src.program);
    if (!preset) {
      warnings.push(`${ms.index} ${ms.name}: GM program ${src.program} absent from the SF2`);
      continue;
    }

    // Walk every key and group runs that resolve to the same sample — inheriting the
    // SoundFont's own zone boundaries instead of guessing them.
    const zones: KeyZone[] = [];
    let runSampleId: string | null = null;
    let runStart = 0;
    for (let key = 0; key <= 127; key++) {
      const v = resolveVoice(preset, key);
      let id: string | null = null;
      if (v) {
        id = sampleIdOf(v.sample);
        if (!blob.index.has(id)) {
          const baked = bakeOne(v.sample);
          blob.add(id, baked.pcm, {
            sampleRate: baked.sampleRate,
            loopStart: baked.loopStart,
            loopEnd: baked.loopEnd,
            rootKey: v.rootKey,
            fineCents: Math.round(v.cents),
          });
        }
      }
      if (id !== runSampleId) {
        if (runSampleId !== null) zones.push({ keyLow: runStart, keyHigh: key - 1, sampleId: runSampleId });
        runSampleId = id;
        runStart = key;
      }
    }
    if (runSampleId !== null) zones.push({ keyLow: runStart, keyHigh: 127, sampleId: runSampleId });

    if (zones.length === 0) warnings.push(`${ms.index} ${ms.name}: preset resolved no zones`);
    zonesByIndex.set(ms.index, zones);
    multisounds.push({
      index: ms.index,
      name: ms.name,
      tracking: ms.tracking,
      synthesized: false,
      sharesSampleWith: null,
      source: `GM ${src.program} ${src.preset}`,
      approx: src.approx === true,
      zones,
    });
  }

  // ---- 3. drums -----------------------------------------------------------------------
  for (const d of DRUM_SOUNDS) {
    const src = DRUM_SOURCES[d.index];
    if (!src) {
      warnings.push(`drum ${d.index} ${d.name}: NO SOURCE MAPPED`);
      continue;
    }
    const preset = src.kind === 'drum' ? drumKits.get(src.kitProgram) : melodic.get(src.program);
    if (!preset) {
      warnings.push(`drum ${d.index} ${d.name}: preset absent from the SF2`);
      continue;
    }
    const v = resolveVoice(preset, src.note);
    if (!v) {
      warnings.push(`drum ${d.index} ${d.name}: nothing sounds at note ${src.note}`);
      continue;
    }
    const id = sampleIdOf(v.sample);
    if (!blob.index.has(id)) {
      // Drums are one-shots: force the loop off regardless of what the SF2 says. A looped
      // kick is a kick that never stops.
      const baked = bakeOne(v.sample, false);
      blob.add(id, baked.pcm, {
        sampleRate: baked.sampleRate,
        loopStart: baked.loopStart,
        loopEnd: baked.loopEnd,
        rootKey: v.rootKey,
        fineCents: Math.round(v.cents),
      });
    }
    drums.push({
      index: d.index,
      name: d.name,
      source: src.kind === 'drum' ? `kit ${src.preset} note ${src.note}` : `GM ${src.program} ${src.preset} note ${src.note}`,
      approx: src.approx === true,
      sampleId: id,
    });
  }

  // ---- 4. write ------------------------------------------------------------------------
  mkdirSync(BANK_OUT_DIR, { recursive: true });
  const pcm = blob.toBuffer();
  writeFileSync(join(BANK_OUT_DIR, 'bank.pcm'), pcm);

  const manifest = {
    format: 1,
    sampleRate: DEFAULT_BANK_RATE,
    pcmFile: 'bank.pcm',
    pcmBytes: pcm.byteLength,
    /** Int16, little-endian, mono, samples concatenated in `samples` order. */
    encoding: 'int16le-mono',
    samples: [...blob.index.values()],
    multisounds,
    drums,
  };
  writeFileSync(join(BANK_OUT_DIR, 'bank.json'), JSON.stringify(manifest, null, 1));

  // ---- 5. THE GATE: loop-seam continuity on every looped sample the bank ships --------
  //
  // Run here rather than only in a unit test, so it is impossible to produce a bank with
  // a clicking loop in it. A unit test proves the algorithm is right on fixtures; this
  // proves the actual output is right on the actual data, which is the claim that matters.
  const seams: Array<{ id: string; score: number }> = [];
  let loopedCount = 0;
  for (const s of blob.index.values()) {
    if (s.loopStart < 0) continue;
    loopedCount++;
    const view = new Int16Array(
      pcm.buffer,
      pcm.byteOffset + s.byteOffset,
      s.length,
    );
    const score = loopSeamDiscontinuity(int16ToFloat(view), {
      loopStart: s.loopStart,
      loopEnd: s.loopEnd,
    });
    if (score > SEAM_LIMIT) seams.push({ id: s.id, score });
  }
  seams.sort((a, b) => b.score - a.score);

  // ---- 6. report ------------------------------------------------------------------------
  const approxMs = multisounds.filter((x) => x.approx).length;
  const approxDr = drums.filter((x) => x.approx).length;
  console.log(`\nbank.pcm   ${(pcm.byteLength / 1024 / 1024).toFixed(1)} MiB (${blob.totalSamples.toLocaleString()} samples)`);
  console.log(`bank.json  ${blob.index.size} distinct samples`);
  console.log(`multisounds ${multisounds.length}/100   (${approxMs} approximated)`);
  console.log(`drums       ${drums.length}/44    (${approxDr} approximated)`);
  const totalZones = multisounds.reduce((n, x) => n + x.zones.length, 0);
  console.log(`key zones   ${totalZones} across all multisounds`);
  console.log(`loop seams  ${loopedCount - seams.length}/${loopedCount} within limit ${SEAM_LIMIT}`);

  if (warnings.length) {
    console.log(`\n${warnings.length} WARNINGS:`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  let failed = false;
  if (seams.length) {
    console.error(`\nGATE FAILED — ${seams.length} looped samples click at the wrap:`);
    for (const s of seams.slice(0, 20)) console.error(`  ! ${s.id}  seam=${s.score.toFixed(2)}`);
    if (seams.length > 20) console.error(`  ... and ${seams.length - 20} more`);
    failed = true;
  }
  if (multisounds.length !== 100 || drums.length !== 44) {
    console.error('\nINCOMPLETE BANK — see warnings above');
    failed = true;
  }
  if (failed) process.exitCode = 1;
  else console.log('\nOK');

  function sampleIdOf(s: BasicSample): string {
    // The sample's name is unique within an SF2 and stable across rebuilds, which the
    // array index is not (it shifts if the source bank is ever swapped).
    return s.name.replace(/[^A-Za-z0-9._-]+/g, '_');
  }

  function bakeOne(s: BasicSample, allowLoop = true) {
    const data = s.getAudioData();
    return bakeSample({
      data,
      sampleRate: s.sampleRate,
      // spessasynth_core has ALREADY rebased these off dwStart — measured, see
      // scripts/probeSf2.ts. Subtracting again would send every loop somewhere else.
      dwStart: 0,
      dwStartloop: s.loopStart,
      dwEndloop: s.loopEnd,
      looped: allowLoop && s.loopEnd > s.loopStart + 1,
    });
  }
}

main();
