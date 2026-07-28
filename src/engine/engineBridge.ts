/**
 * The ONE seam between React and the engine.
 *
 * A singleton living outside React: the AudioContext, the worklet node and the bank are
 * all process-wide, and making them React state would tie their lifetime to a component
 * tree that re-renders for unrelated reasons.
 *
 * React calls imperative methods here; nothing in this file imports React.
 *
 * PHASE 3 replaced the flat placeholder program this file used to build inline. The
 * parameter values now live in the state tree, `programConfigCore` maps them onto the
 * engine's config, and this file's remaining job is the impure half: turning a multisound
 * INDEX into actual PCM, and getting the result across to the worklet.
 */

import { snapEffectParam } from '../../data/effectParams';
import { loadBank, type BankMultisound, type LoadedBank } from './bankLoader';
import type { RecordFormat } from './recordHelpers';
import { StudioContext } from './context';
import { buildProgramConfig, type OscSource } from './program/programConfigCore';
import { buildKeymap, type KeyZoneSpec } from './voice/keymapCore';
import type { SerializedProgram, SerializedSample } from './voiceMessages';
import { m1Store } from '../state/store';

export interface BridgeStatus {
  powered: boolean;
  bankLoaded: boolean;
  bankError: string | null;
}

type Listener = (s: BridgeStatus) => void;

/** An oscillator's bank half: the keymap plus the sample table it indexes into. */
type OscBankSource = OscSource<SerializedSample>;

class EngineBridge {
  private studio = new StudioContext();
  private node: AudioWorkletNode | null = null;
  private bank: LoadedBank | null = null;
  private listeners = new Set<Listener>();
  private status: BridgeStatus = { powered: false, bankLoaded: false, bankError: null };
  /**
   * Built keymaps, keyed by what determines them.
   *
   * Turning a knob re-pushes the whole program, and a program carries two 32 KB keymaps.
   * Rebuilding those on every pointermove of a drag would burn ~4 MB/s of allocation to
   * produce a byte-identical result, so they are cached on the only inputs that change
   * them: the oscillator mode and the multisound index.
   */
  private readonly sourceCache = new Map<string, OscBankSource>();
  /**
   * Parameters mid-drag: pushed to the engine but not yet written to the store. Cleared as
   * each one commits, so the store stays the single source of truth for everything settled.
   */
  private readonly pending = new Map<string, number | string>();
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
    else this.refresh();
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
      this.refresh();
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

  // ---- parameters -----------------------------------------------------------------------

  /**
   * Set one program parameter: store write plus engine push. The COMMIT path — knob release,
   * double-click reset, and every discrete control.
   */
  setParam(id: string, value: number | string): void {
    this.pending.delete(id);
    m1Store.setProgramParam(id, value);
    this.pushProgram();
  }

  /**
   * Push a parameter to the engine WITHOUT writing the store. The drag path.
   *
   * A knob fires `onInput` on every pointermove, and a store write notifies every
   * subscriber — so routing the drag through `setParam` would re-render the whole panel
   * sixty times a second to change one number. The parameter is held here until the drag
   * commits, which keeps the audio responding immediately while React sees one update.
   */
  previewParam(id: string, value: number | string): void {
    this.pending.set(id, value);
    this.pushProgram();
  }

  /** Extensions live outside the program (they are not 1988 parameters). */
  setResonance(on: boolean): void {
    m1Store.setExtension('resonance', on);
    this.pushProgram();
  }

  // ---- master recording -------------------------------------------------------------------
  // Thin forwards: StudioContext owns the recorder (it needs the private context and the
  // softClip tap), the UI owns the button, and this is the one seam between them.

  /** 'wav' = lossless PCM tap; 'webm' = MediaRecorder/opus. Safe to call before power-on. */
  setRecordFormat(format: RecordFormat): void {
    this.studio.setRecordFormat(format);
  }

  /** Begin recording the master output. False when unpowered or unsupported. */
  startRecording(): boolean {
    return this.studio.startRecording();
  }

  /** Stop, assemble the file, and trigger its download. */
  stopRecording(): Promise<Blob | null> {
    return this.studio.stopRecording();
  }

  /** Poll source for the RECORD lamp and elapsed readout. */
  getRecordingState(): { recording: boolean; elapsedMs: number } {
    return this.studio.getRecordingState();
  }

  // ---- effects ----------------------------------------------------------------------------
  //
  // Pushed SEPARATELY from the program, not folded into it. A program push carries two 32 KB
  // keymaps; the effect section is a few dozen numbers, and turning a reverb knob has no
  // reason to move 64 KB. The two are independent on the wire for the same reason the
  // keymaps are cached.

  /**
   * Select an algorithm. Returns false if the pairing restriction forbids it — Symphonic
   * Ensemble and Rotary Speaker cannot sit opposite an asterisked modulation effect.
   */
  setEffectType(slot: 1 | 2, type: number): boolean {
    const ok = m1Store.setEffectType(slot, type);
    if (ok) this.pushEffects();
    return ok;
  }

  setEffectParam(slot: 1 | 2, id: string, value: number | string): void {
    this.pendingEffects.delete(`${slot}:${id}`);
    m1Store.setEffectParam(slot, id, value);
    this.pushEffects();
  }

  /**
   * The drag path, exactly as `previewParam` is for program parameters — and it SNAPS.
   * The store snaps on commit; without snapping here too, the whole quantization grid would
   * exist everywhere except while you were actually turning the knob.
   */
  previewEffectParam(slot: 1 | 2, id: string, value: number | string): void {
    const type = m1Store.getEffectSlot(slot).type;
    this.pendingEffects.set(`${slot}:${id}`, snapEffectParam(type, id, value));
    this.pushEffects();
  }

  setEffectBalance(slot: 1 | 2, which: 'A' | 'B', value: number): void {
    this.pendingBalance.delete(`${slot}:${which}`);
    m1Store.setEffectBalance(slot, which, value);
    this.pushEffects();
  }

  previewEffectBalance(slot: 1 | 2, which: 'A' | 'B', value: number): void {
    this.pendingBalance.set(`${slot}:${which}`, value);
    this.pushEffects();
  }

  setEffectRouting(serial: boolean): void {
    m1Store.setEffectRouting(serial);
    this.pushEffects();
  }

  setEffectIo(id: 'fx1L' | 'fx1R' | 'fx2L' | 'fx2R', on: boolean): void {
    m1Store.setEffectIo(id, on);
    this.pushEffects();
  }

  /** Mid-drag effect values, same contract as `pending` for program parameters. */
  private readonly pendingEffects = new Map<string, number | string>();
  private readonly pendingBalance = new Map<string, number>();

  private pushEffects(): void {
    if (!this.node) return;
    const effects = m1Store.getState().program.effects;
    if (this.pendingEffects.size > 0 || this.pendingBalance.size > 0) {
      for (const [key, value] of this.pendingEffects) {
        const [slot, id] = splitPending(key);
        effects.slots[slot - 1]!.params[id] = value;
      }
      for (const [key, value] of this.pendingBalance) {
        const [slot, which] = splitPending(key);
        const s = effects.slots[slot - 1]!;
        if (which === 'A') s.balanceA = value;
        else s.balanceB = value;
      }
    }
    this.node.port.postMessage({ type: 'effects', effects });
  }

  private sampleOf(id: string): SerializedSample | null {
    const meta = this.bank?.byId.get(id);
    if (!meta) return null;
    return {
      offset: meta.byteOffset / 2,
      length: meta.length,
      loopStart: meta.loopStart,
      loopEnd: meta.loopEnd,
      rootKey: meta.rootKey,
      fineCents: meta.fineCents,
      sampleRate: meta.sampleRate,
    };
  }

  /** One multisound's key zones, as a keymap plus the sample table it indexes. */
  private buildMultisoundSource(msIndex: number): OscBankSource | null {
    const bank = this.bank;
    if (!bank) return null;
    const ms = bank.manifest.multisounds.find((m) => m.index === msIndex);
    if (!ms) return null;

    const samples: SerializedSample[] = [];
    const byId = new Map<string, number>();
    const zones: KeyZoneSpec[] = [];
    for (const z of ms.zones) {
      let idx = byId.get(z.sampleId);
      if (idx === undefined) {
        const s = this.sampleOf(z.sampleId);
        if (!s) continue;
        idx = samples.length;
        byId.set(z.sampleId, idx);
        samples.push(s);
      }
      zones.push({ keyLow: z.keyLow, keyHigh: z.keyHigh, sampleIndex: idx });
    }
    return { keymap: buildKeymap(zones), samples };
  }

  /**
   * The drum kit: every drum sound on its own key, exactly as the manifest places it.
   *
   * One key per sound, not a zone — a drum is a fixed-pitch one-shot, so spreading it over
   * neighbouring keys would transpose it and turn a snare into a different drum. Keys with
   * no drum assigned stay silent, which is what the hardware does.
   */
  private buildDrumSource(): OscBankSource | null {
    const bank = this.bank;
    if (!bank) return null;
    const samples: SerializedSample[] = [];
    const zones: KeyZoneSpec[] = [];
    for (const d of bank.manifest.drums) {
      const s = this.sampleOf(d.sampleId);
      if (!s) continue;
      // The drum's own root key, so it plays back at its recorded pitch on its assigned note.
      zones.push({ keyLow: d.note, keyHigh: d.note, sampleIndex: samples.length });
      samples.push({ ...s, rootKey: d.note, fineCents: d.fineCents });
    }
    return { keymap: buildKeymap(zones), samples };
  }

  private sourceFor(oscIndex: 1 | 2, msIndex: number, drums: boolean): OscBankSource | null {
    const key = drums ? 'drums' : `ms:${msIndex}`;
    const hit = this.sourceCache.get(key);
    if (hit) return hit;
    const built = drums ? this.buildDrumSource() : this.buildMultisoundSource(msIndex);
    if (built) this.sourceCache.set(key, built);
    void oscIndex;
    return built;
  }

  private pushProgram(): void {
    if (!this.node || !this.bank) return;
    const state = m1Store.getState();
    // Mid-drag values sit on top of the committed tree, so the engine hears the knob as it
    // moves while the store still holds the last settled value.
    const params =
      this.pending.size === 0
        ? state.program.params
        : { ...state.program.params, ...Object.fromEntries(this.pending) };
    const drums = params.OSC_MODE === 'DRUMS';

    const s1 = this.sourceFor(1, Number(params.OSC1_MULTISOUND ?? 0), drums);
    const s2 = this.sourceFor(2, Number(params.OSC2_MULTISOUND ?? 0), drums);
    if (!s1) return;
    const src2 = s2 ?? s1;

    // The engine's config is built from the parameter model; only the PCM is supplied here.
    // `buildProgramConfig` coalesces, so a hand-edited bundle cannot reach the worklet with
    // an out-of-range value. Generic in the sample type, so what comes back IS the wire
    // format — no cast, and no field can be dropped in transit.
    const program: SerializedProgram = buildProgramConfig<SerializedSample>(
      params,
      [s1, src2] as [OscSource<SerializedSample>, OscSource<SerializedSample>],
      { resonance: state.extensions.resonance ? 1 : 0 },
    );
    this.node.port.postMessage({ type: 'program', program });
  }

  /** Re-push after something outside the params bag changed (bank load, extension toggle). */
  refresh(): void {
    this.pushProgram();
    this.pushEffects();
  }

  // ---- performance ------------------------------------------------------------------------

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

  /** Joystick. X (-1..1) bends pitch; Y (-1..1) drives the MG and filter-sweep depths. */
  setJoystick(x: number, y: number): void {
    this.node?.port.postMessage({ type: 'joystick', x, y });
  }

  /** Channel aftertouch, 0..1. */
  setAftertouch(value: number): void {
    this.node?.port.postMessage({ type: 'aftertouch', value });
  }

  allNotesOff(): void {
    this.heldNotes.clear();
    this.node?.port.postMessage({ type: 'allNotesOff' });
  }
}

/** `"1:DEPTH"` -> `[1, 'DEPTH']`. The pending maps are keyed by slot so the two cannot mix. */
function splitPending(key: string): [1 | 2, string] {
  const i = key.indexOf(':');
  const slot = key.slice(0, i) === '2' ? 2 : 1;
  return [slot, key.slice(i + 1)];
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
  (globalThis as unknown as { __borgm1store?: unknown }).__borgm1store = m1Store;
}
