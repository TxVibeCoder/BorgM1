/**
 * The ONE seam between React and the engine.
 *
 * A singleton living outside React: the AudioContext, the worklet node and the bank are
 * all process-wide, and making them React state would tie their lifetime to a component
 * tree that re-renders for unrelated reasons.
 *
 * React calls imperative methods here; nothing in this file imports React.
 */

import { loadBank, type BankMultisound, type LoadedBank } from './bankLoader';
import { StudioContext } from './context';
import { ampEgConfig, filterEgConfig, pitchEgConfig } from './dsp/levelTimeEgCore';
import { buildKeymap, type KeyZoneSpec } from './voice/keymapCore';
import type { SerializedOsc, SerializedProgram } from './voiceMessages';
import type { OscMode } from './voice/voiceEngineCore';

export interface BridgeStatus {
  powered: boolean;
  bankLoaded: boolean;
  bankError: string | null;
  multisound: number;
  oscMode: OscMode;
}

type Listener = (s: BridgeStatus) => void;

/**
 * A flat, neutral program: instant attack, full sustain, filter wide open, no filter EG.
 *
 * That is not a placeholder — it is the shape `I17 Organ 2` actually uses, and it is the
 * right default for Phase 2 because it makes the SAMPLE audible with nothing layered on
 * top. Phase 3 replaces this with the real 143-parameter model from the SysEx table.
 */
function neutralOsc(keymap: Uint16Array, samples: SerializedOsc['samples']): SerializedOsc {
  return {
    keymap,
    samples,
    level: 0.7,
    octave: 0,
    interval: 0,
    detune: 0,
    ampEg: ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
      slopeTime: 0, sustainLevel: 1, releaseTime: 25,
    }),
    filterEg: filterEgConfig({
      attackTime: 0, attackLevel: 0, decayTime: 0, breakPoint: 0,
      slopeTime: 0, sustainLevel: 0, releaseTime: 0, releaseLevel: 0,
    }),
    pitchEg: pitchEgConfig({
      startLevel: 0, attackTime: 0, attackLevel: 0, decayTime: 0,
      releaseTime: 0, releaseLevel: 0,
    }),
    cutoffHz: 16000,
    egIntensity: 0,
    // -99 is NO tracking. 0 would mean 100% tracking (the documented trap) and is NOT a
    // neutral default, however much it looks like one.
    cutoffTracking: -99,
    velocitySensitivity: 0.6,
  };
}

class EngineBridge {
  private studio = new StudioContext();
  private node: AudioWorkletNode | null = null;
  private bank: LoadedBank | null = null;
  private listeners = new Set<Listener>();
  private status: BridgeStatus = {
    powered: false,
    bankLoaded: false,
    bankError: null,
    multisound: 6, // Organ2 — the acceptance-test sound
    oscMode: 'SINGLE',
  };
  /** Notes currently down, so the UI can light keys and a panic can clear them. */
  readonly heldNotes = new Set<number>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  private emit(patch: Partial<BridgeStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  /** POWER. Must be called from a user gesture — it is the autoplay unlock. */
  async powerOn(): Promise<void> {
    const ctx = await this.studio.powerOn();
    if (!this.node) {
      this.node = new AudioWorkletNode(ctx, 'borgm1-voice', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.connect(this.studio.masterIn);
    }
    this.emit({ powered: true });
    if (!this.bank) await this.ensureBank();
    else this.pushProgram();
  }

  async powerOff(): Promise<void> {
    this.allNotesOff();
    await this.studio.powerOff();
    this.emit({ powered: false });
  }

  /** Load the bank and hand its PCM to the worklet. Idempotent. */
  async ensureBank(): Promise<void> {
    if (this.bank) return;
    try {
      const base = `${import.meta.env.BASE_URL}bank`;
      this.bank = await loadBank(base);
      // TRANSFER, don't copy: 100 MiB of float would otherwise be structurally cloned.
      // A transferred buffer is detached here, so the bridge keeps its own view for the
      // UI by re-reading from the manifest rather than from `pcm`.
      const pcm = this.bank.pcm;
      this.node?.port.postMessage({ type: 'bank', pcm }, [pcm.buffer]);
      this.emit({ bankLoaded: true, bankError: null });
      this.pushProgram();
    } catch (err) {
      this.emit({ bankLoaded: false, bankError: err instanceof Error ? err.message : String(err) });
    }
  }

  get multisounds(): BankMultisound[] {
    return this.bank?.manifest.multisounds ?? [];
  }

  /** The node the engine renders into. Used by the dev harness to tap the graph. */
  get outputNode(): AudioNode | null {
    return this.node;
  }

  get audioContext(): AudioContext | null {
    return this.status.powered ? this.studio.audioContext : null;
  }

  setMultisound(index: number): void {
    this.emit({ multisound: index });
    this.pushProgram();
  }

  setOscMode(mode: OscMode): void {
    this.emit({ oscMode: mode });
    this.pushProgram();
  }

  /** Build the serialized oscillator for one multisound index. */
  private buildOsc(msIndex: number): SerializedOsc | null {
    const bank = this.bank;
    if (!bank) return null;
    const ms = bank.manifest.multisounds.find((m) => m.index === msIndex);
    if (!ms) return null;

    const samples: SerializedOsc['samples'] = [];
    const byId = new Map<string, number>();
    const zones: KeyZoneSpec[] = [];
    for (const z of ms.zones) {
      let idx = byId.get(z.sampleId);
      if (idx === undefined) {
        const meta = bank.byId.get(z.sampleId);
        if (!meta) continue;
        idx = samples.length;
        byId.set(z.sampleId, idx);
        samples.push({
          offset: meta.byteOffset / 2,
          length: meta.length,
          loopStart: meta.loopStart,
          loopEnd: meta.loopEnd,
          rootKey: meta.rootKey,
          fineCents: meta.fineCents,
          sampleRate: meta.sampleRate,
        });
      }
      zones.push({ keyLow: z.keyLow, keyHigh: z.keyHigh, sampleIndex: idx });
    }
    return neutralOsc(buildKeymap(zones), samples);
  }

  private pushProgram(): void {
    if (!this.node || !this.bank) return;
    const osc = this.buildOsc(this.status.multisound);
    if (!osc) return;
    // Oscillator 2 gets its own keymap object so the two halves never alias — the `1`/`2`
    // rule in the UI depends on them being independently editable in Phase 3.
    const osc2 = this.buildOsc(this.status.multisound) ?? osc;
    const program: SerializedProgram = {
      oscMode: this.status.oscMode,
      resonance: 0, // extension, defaults OFF
      osc: [osc, osc2],
    };
    this.node.port.postMessage({ type: 'program', program });
  }

  noteOn(note: number, velocity = 100): void {
    if (!this.node) return;
    this.heldNotes.add(note);
    this.node.port.postMessage({ type: 'noteOn', note, velocity });
  }

  noteOff(note: number): void {
    this.heldNotes.delete(note);
    this.node?.port.postMessage({ type: 'noteOff', note });
  }

  setSustain(down: boolean): void {
    this.node?.port.postMessage({ type: 'sustain', down });
  }

  allNotesOff(): void {
    this.heldNotes.clear();
    this.node?.port.postMessage({ type: 'allNotesOff' });
  }
}

export const engineBridge = new EngineBridge();

/**
 * DEV-ONLY handle. The Phase 2 offline audio battery drives the engine from a Playwright
 * spec, and an AudioWorklet cannot be measured from Node — so the harness needs a way to
 * reach the graph from the page. Stripped from production builds by the `import.meta.env`
 * guard, which Vite evaluates statically.
 */
if (import.meta.env.DEV) {
  (globalThis as unknown as { __borgm1?: unknown }).__borgm1 = engineBridge;
}
