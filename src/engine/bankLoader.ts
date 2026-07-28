/**
 * Factory bank loading.
 *
 * THE CACHE API, NOT IndexedDB. IndexedDB deserializes on retrieval, which makes it the
 * worst possible home for a 50 MiB PCM blob — every open would pay a full structured-clone
 * pass. The Cache API hands back a Response whose ArrayBuffer is read once, straight into
 * the typed array the engine plays from. `sampleStore.ts` keeps IndexedDB for USER samples,
 * which are small and individually addressed; do not merge the two.
 */

import type { SampleRef } from './dsp/samplePlayerCore';

const CACHE_NAME = 'borgm1-bank-v1';

export interface BankSampleMeta {
  id: string;
  byteOffset: number;
  /** Length in SAMPLES, not bytes. */
  length: number;
  sampleRate: number;
  loopStart: number;
  loopEnd: number;
  rootKey: number;
  fineCents: number;
}

export interface BankKeyZone {
  keyLow: number;
  keyHigh: number;
  sampleId: string;
}

export interface BankMultisound {
  index: number;
  name: string;
  tracking: boolean;
  synthesized: boolean;
  sharesSampleWith: number | null;
  source: string;
  approx: boolean;
  keyLow: number;
  keyHigh: number;
  zones: BankKeyZone[];
}

export interface BankDrum {
  index: number;
  name: string;
  source: string;
  approx: boolean;
  sampleId: string;
  note: number;
  rootKey: number;
  fineCents: number;
}

export interface BankManifest {
  format: number;
  sampleRate: number;
  pcmFile: string;
  pcmBytes: number;
  encoding: string;
  samples: BankSampleMeta[];
  multisounds: BankMultisound[];
  drums: BankDrum[];
}

export interface LoadedBank {
  manifest: BankManifest;
  /** The whole PCM blob as float, sliced by `sampleRef`. */
  pcm: Float32Array;
  byId: Map<string, BankSampleMeta>;
  /** A playable ref for one sample id, or null. */
  sampleRef(id: string): (SampleRef & { rootKey: number; fineCents: number; sampleRate: number }) | null;
}

async function cachedFetch(url: string): Promise<Response> {
  if (typeof caches === 'undefined') return fetch(url);
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (res.ok) await cache.put(url, res.clone());
  return res;
}

/**
 * Convert the whole Int16 blob to float ONCE, at load.
 *
 * 50 MiB of Int16 becomes 100 MiB of Float32, which is the trade being made deliberately:
 * converting per sample inside `process()` would put a multiply and a type conversion on
 * the innermost loop of the engine, for every voice, forever. Memory is cheap on a
 * PC-only target; the render budget is not.
 */
function int16BlobToFloat(buf: ArrayBuffer): Float32Array {
  const src = new Int16Array(buf);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i]! / 32767;
  return out;
}

export async function loadBank(baseUrl = 'bank'): Promise<LoadedBank> {
  const manifestRes = await cachedFetch(`${baseUrl}/bank.json`);
  if (!manifestRes.ok) throw new Error(`bank manifest: HTTP ${manifestRes.status}`);
  const manifest = (await manifestRes.json()) as BankManifest;

  const pcmRes = await cachedFetch(`${baseUrl}/${manifest.pcmFile}`);
  if (!pcmRes.ok) throw new Error(`bank pcm: HTTP ${pcmRes.status}`);
  const raw = await pcmRes.arrayBuffer();
  if (raw.byteLength !== manifest.pcmBytes) {
    // A truncated blob reads as garbage rather than failing, so check it rather than
    // discovering it as noise on one particular note.
    throw new Error(`bank pcm truncated: got ${raw.byteLength}, expected ${manifest.pcmBytes}`);
  }
  const pcm = int16BlobToFloat(raw);

  const byId = new Map(manifest.samples.map((s) => [s.id, s]));

  return {
    manifest,
    pcm,
    byId,
    sampleRef(id: string) {
      const meta = byId.get(id);
      if (!meta) return null;
      const start = meta.byteOffset / 2;
      return {
        // subarray, not slice: a view costs nothing and the blob outlives every voice.
        data: pcm.subarray(start, start + meta.length),
        loopStart: meta.loopStart,
        loopEnd: meta.loopEnd,
        rootKey: meta.rootKey,
        fineCents: meta.fineCents,
        sampleRate: meta.sampleRate,
      };
    },
  };
}

/** Discard the cached bank — for a version bump or a corrupt download. */
export async function clearBankCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(CACHE_NAME);
}
