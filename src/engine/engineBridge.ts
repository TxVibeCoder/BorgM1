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

import { programRefToIndex, type ProgramRef } from '../../data/combiParams';
import { snapEffectParam } from '../../data/effectParams';
import { defaultProgramParams } from '../../data/programParams';
import { loadBank, type BankMultisound, type LoadedBank } from './bankLoader';
import type { RecordFormat } from './recordHelpers';
import { StudioContext } from './context';
import { buildCombiTimbres, silentTimbre } from './program/combiConfigCore';
import { buildProgramConfig, type OscSource } from './program/programConfigCore';
import { buildKeymap, type KeyZoneSpec } from './voice/keymapCore';
import type { SerializedProgram, SerializedSample, SerializedTimbre } from './voiceMessages';
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

  /**
   * Output 3/4 pan: `0` = OFF, `1` = R, `2..100` = ratio, `101` = L. These place outputs 3 and
   * 4 in the main stereo pair, and they are the only reason a timbre panned to C/D is audible
   * on a two-output host at all — see `mixPanned` in `effectChainCore`.
   */
  setEffectOutPan(which: 3 | 4, value: number): void {
    m1Store.setEffectOutPan(which, value);
    this.pushEffects();
  }

  /** Mid-drag effect values, same contract as `pending` for program parameters. */
  private readonly pendingEffects = new Map<string, number | string>();
  private readonly pendingBalance = new Map<string, number>();

  private pushEffects(): void {
    if (!this.node) return;
    // Whichever mode's effect section is current — a Combination has its own 25-byte block.
    const state = m1Store.getState();
    const effects = state.mode === 'COMBI' ? state.combi.effects : state.program.effects;
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

  /** Build one engine program from a params bag plus the bank. Null if the bank is not ready. */
  private buildProgram(
    params: Record<string, number | string>,
    resonance: number,
  ): SerializedProgram | null {
    const drums = params.OSC_MODE === 'DRUMS';
    const s1 = this.sourceFor(1, Number(params.OSC1_MULTISOUND ?? 0), drums);
    const s2 = this.sourceFor(2, Number(params.OSC2_MULTISOUND ?? 0), drums);
    if (!s1) return null;
    // The engine's config is built from the parameter model; only the PCM is supplied here.
    // `buildProgramConfig` coalesces, so a hand-edited bundle cannot reach the worklet with
    // an out-of-range value. Generic in the sample type, so what comes back IS the wire
    // format — no cast, and no field can be dropped in transit.
    return buildProgramConfig<SerializedSample>(
      params,
      [s1, s2 ?? s1] as [OscSource<SerializedSample>, OscSource<SerializedSample>],
      { resonance },
    );
  }

  /** The edit buffer's parameters, with any mid-drag values on top. */
  private editBufferParams(): Record<string, number | string> {
    const params = m1Store.getState().program.params;
    return this.pending.size === 0 ? params : { ...params, ...Object.fromEntries(this.pending) };
  }

  /**
   * PHASE 5 STAND-IN FOR THE PROGRAM BANK, and it is deliberately labelled as one.
   *
   * A Combination timbre stores a POINTER (`I00`..`C99`), and the 100 factory programs behind
   * those pointers are Phase 6's job — `decodeProgram` is written and tested but the preload is
   * not imported yet. Until it is, a slot that is not the edit buffer materialises as the INIT
   * program with its MULTISOUND set to the slot number, so `I00` is A.Piano, `I05` is Organ1,
   * and eight timbres are eight audibly different sounds.
   *
   * That is not a guess at Korg's bank and must never be mistaken for one; it is a 1:1 map onto
   * the 100 multisounds the sample bank actually contains. **Phase 6 replaces this one method
   * and nothing else** — the resolver is injected into `buildCombiTimbres` precisely so that
   * swap costs a line.
   *
   * THE EDIT BUFFER WINS over the stand-in for its own slot, which is the hardware's behaviour:
   * a Combination timbre plays the program as currently edited, not a stale copy.
   */
  private programParamsFor(ref: ProgramRef): Record<string, number | string> | null {
    const index = programRefToIndex(ref);
    if (index === null) return null;
    const state = m1Store.getState();
    const editSlot = state.program.slot ?? 'I00';
    if (ref === editSlot) return this.editBufferParams();
    // Only the internal bank has samples behind it; a card slot has nothing to play.
    if (index >= 100) return null;
    return { ...defaultProgramParams(), OSC1_MULTISOUND: index, OSC2_MULTISOUND: index };
  }

  private pushProgram(): void {
    if (!this.node || !this.bank) return;
    const state = m1Store.getState();
    if (state.mode === 'COMBI') {
      this.pushTimbres();
      return;
    }
    const program = this.buildProgram(
      this.editBufferParams(),
      state.extensions.resonance ? 1 : 0,
    );
    if (!program) return;
    this.node.port.postMessage({ type: 'program', program });
  }

  /**
   * Push the Combination's timbres.
   *
   * A dropped timbre becomes a SILENT PLACEHOLDER rather than being removed, so every timbre
   * keeps its row index — the allocator's same-note rule and the engine's per-timbre MG phases
   * both key on that index, and closing the gap would silently retune every timbre above a
   * muted one.
   */
  private pushTimbres(): void {
    if (!this.node || !this.bank) return;
    const state = m1Store.getState();
    const resonance = state.extensions.resonance ? 1 : 0;
    const params =
      this.pendingCombi.size === 0
        ? state.combi.params
        : { ...state.combi.params, ...Object.fromEntries(this.pendingCombi) };

    const silentProgram = this.buildProgram(defaultProgramParams(), resonance);
    if (!silentProgram) return;

    const resolved = buildCombiTimbres<SerializedSample>({
      params,
      solo: state.combi.solo,
      resolveProgram: (ref) => {
        const p = this.programParamsFor(ref);
        return p ? this.buildProgram(p, resonance) : null;
      },
    });
    const timbres: SerializedTimbre[] = resolved.map(
      (t) => t ?? silentTimbre<SerializedSample>(silentProgram),
    );
    this.node.port.postMessage({ type: 'timbres', timbres });
  }

  /** Re-push after something outside the params bag changed (bank load, extension toggle). */
  refresh(): void {
    this.pushProgram();
    this.pushEffects();
    this.node?.port.postMessage({
      type: 'globalChannel',
      channel: Math.max(0, m1Store.getState().keyboard.midiChannel),
    });
  }

  // ---- combinations -------------------------------------------------------------------

  /** Mid-drag combination values, same contract as `pending` for program parameters. */
  private readonly pendingCombi = new Map<string, number | string>();

  setMode(mode: 'PROGRAM' | 'COMBI'): void {
    m1Store.setMode(mode);
    // Notes belonging to the old mode's timbres would keep sounding against the new mode's
    // configuration, on slots the new timbres do not own.
    this.allNotesOff();
    this.refresh();
  }

  setCombiParam(id: string, value: number | string): void {
    this.pendingCombi.delete(id);
    m1Store.setCombiParam(id, value);
    this.pushTimbres();
  }

  /** Mid-drag: push without a store write, exactly as `previewParam` does. */
  previewCombiParam(id: string, value: number | string): void {
    this.pendingCombi.set(id, value);
    this.pushTimbres();
  }

  setCombiParams(patch: Record<string, number | string>): void {
    for (const id of Object.keys(patch)) this.pendingCombi.delete(id);
    m1Store.setCombiParams(patch);
    this.pushTimbres();
  }

  setCombiType(type: string): void {
    m1Store.setCombiType(type);
    this.allNotesOff();
    this.pushTimbres();
  }

  setTimbreSolo(timbre: number, on: boolean): void {
    m1Store.setTimbreSolo(timbre, on);
    this.pushTimbres();
  }

  // ---- performance ------------------------------------------------------------------------

  /**
   * `channel` defaults to the GLOBAL channel, which is what the on-screen keybed plays on.
   * Manual p.73: "When playing the keyboard of the M1, only the Timbres which are set to the
   * same channel as the MIDI Global channel will sound." Web MIDI passes its own channel, so
   * a multi-channel controller can drive eight timbres independently.
   */
  private get keyboardChannel(): number {
    return Math.max(0, m1Store.getState().keyboard.midiChannel);
  }

  noteOn(note: number, velocity = 100, channel = this.keyboardChannel): void {
    if (!this.node) return;
    this.heldNotes.add(note);
    this.node.port.postMessage({ type: 'noteOn', note, velocity, channel });
  }

  noteOff(note: number, channel = this.keyboardChannel): void {
    this.heldNotes.delete(note);
    this.node?.port.postMessage({ type: 'noteOff', note, channel });
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
