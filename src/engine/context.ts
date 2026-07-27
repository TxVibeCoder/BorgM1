/**
 * AudioContext lifecycle, power switch, master bus.
 * Power ON is the user-gesture unlock; power OFF suspends. Master chain:
 *   masterIn -> insertSlot (passthrough) -> masterVolume -> softClip -> destination.
 * The effects section (Phase 4) is a node swap at insertSlot, not a refactor.
 *
 * WORKLET_URLS holds only the PCM capture tap until Phase 2 lands the voice
 * processor. When it does there will be exactly ONE more entry: a single processor
 * owns all 16 oscillator slots (CLAUDE.md), so this list is not expected to grow
 * with the engine.
 *
 * The iOS unlock dance SynthStack carried (in-gesture resume() before any await,
 * plus a one-frame silent BufferSource) is gone — BorgM1 is PC-only, which also
 * dodges mobile Safari's uncatchable ~100–200 MB audio-memory crash.
 */

// ?worker&url (not plain ?url): plain ?url ships the RAW .ts as an inlined
// data:video/mp2t asset in builds — uncompiled, unloadable. ?worker&url compiles
// the worklet module graph (including the pure DSP cores) into a real emitted chunk
// that addModule() can load in both dev and build.
import pcmTapWorkletUrl from './worklets/pcmTap.worklet.ts?worker&url';
import { MasterRecorder } from './recorder';
import type { RecordFormat } from './recordHelpers';

export const WORKLET_URLS = [pcmTapWorkletUrl];

/** Load our worklet modules into any context (each Offline context needs this too). */
export async function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  for (const url of WORKLET_URLS) {
    await ctx.audioWorklet.addModule(url);
  }
}

function makeSoftClipCurve(samples = 2048): Float32Array {
  // gentle tanh: unity-ish below ~0.7, saturating toward ±1
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  return curve;
}

export class StudioContext {
  private ctx: AudioContext | null = null;
  private _masterIn: GainNode | null = null;
  private insertSlot: GainNode | null = null;
  private masterVolume: GainNode | null = null;
  private softClip: WaveShaperNode | null = null;
  private workletsLoaded = false;
  private powered = false;
  /** Lazy master-output recorder — built on first record off the softClip tap; null
   *  until then and before powerOn builds the graph. Runtime-only (never serialized). */
  private recorder: MasterRecorder | null = null;
  onStateChange: ((powered: boolean) => void) | null = null;

  /** Must be called from a user gesture (autoplay policy). */
  async powerOn(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this._masterIn = this.ctx.createGain();
      this.insertSlot = this.ctx.createGain();
      this.masterVolume = this.ctx.createGain();
      this.masterVolume.gain.value = 0.8;
      this.softClip = this.ctx.createWaveShaper();
      this.softClip.curve = makeSoftClipCurve() as Float32Array<ArrayBuffer>;
      this.softClip.oversample = '2x';
      this._masterIn.connect(this.insertSlot);
      this.insertSlot.connect(this.masterVolume);
      this.masterVolume.connect(this.softClip).connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => {
        this.onStateChange?.(this.ctx?.state === 'running');
      });
    }
    const resuming = this.ctx.resume();
    if (!this.workletsLoaded) {
      await loadWorklets(this.ctx);
      this.workletsLoaded = true;
    }
    await resuming;
    this.powered = true;
    return this.ctx;
  }

  async powerOff(): Promise<void> {
    this.powered = false;
    // Auto-stop a recording in progress BEFORE suspend, while the context is STILL
    // running, so the final dataavailable fires and the blob/download complete (a POWER
    // toggle mid-record still yields a full file).
    if (this.recorder?.getState().recording) await this.recorder.stop();
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  get isPowered(): boolean {
    return this.powered && this.ctx?.state === 'running';
  }

  get audioContext(): AudioContext {
    if (!this.ctx) throw new Error('powerOn() first');
    return this.ctx;
  }

  get masterIn(): GainNode {
    if (!this._masterIn) throw new Error('powerOn() first');
    return this._masterIn;
  }

  setMasterVolume(v01: number): void {
    if (this.masterVolume) this.masterVolume.gain.value = v01;
  }

  // ---- master-output recording ------------------------------------------------------
  // The recorder taps softClip (the final audible node) via an ADDITIVE fan-out — the
  // softClip->destination edge is never touched, so monitoring continues. It is owned
  // here because it needs the private ctx + softClip; the bridge only forwards.

  /** Build the recorder on first use. Returns null before powerOn builds the graph. */
  private getRecorder(): MasterRecorder | null {
    if (!this.softClip || !this.ctx) return null;
    if (!this.recorder) this.recorder = new MasterRecorder(this.ctx, this.softClip);
    return this.recorder;
  }

  /** Select the capture format ('webm' lossy | 'wav' lossless) for the next take. Builds the
   *  recorder lazily so a pre-record selection sticks; no-op before the graph exists. */
  setRecordFormat(format: RecordFormat): void {
    this.getRecorder()?.setFormat(format);
  }

  /** Begin recording the master mix. No-op-safe (false) when unpowered/unsupported. */
  startRecording(): boolean {
    return this.getRecorder()?.start() ?? false;
  }

  /** Stop recording: assembles the Blob + triggers the download in the recorder's onstop.
   *  Reads the field directly (never lazily constructs — nothing to stop otherwise). */
  stopRecording(): Promise<Blob | null> {
    return this.recorder?.stop() ?? Promise.resolve(null);
  }

  /** UI poll source for the RECORD lamp + elapsed readout. {false,0} before first record. */
  getRecordingState(): { recording: boolean; elapsedMs: number } {
    return this.recorder?.getState() ?? { recording: false, elapsedMs: 0 };
  }

  /** Debug-panel info. */
  get baseLatency(): number {
    return this.ctx?.baseLatency ?? 0;
  }
}
