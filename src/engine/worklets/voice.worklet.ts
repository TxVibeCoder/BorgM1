/**
 * THE voice processor — ONE AudioWorkletProcessor owning all 16 oscillator slots.
 *
 * Not one node per voice. One node gets the whole 2.67 ms render quantum instead of a
 * sixteenth of it, and note-on stops meaning "build and connect a node graph" — which at
 * note rate would churn hundreds of nodes.
 *
 * A THIN SHELL. Everything audible is in VoiceEngine, which is pure and Node-tested. This
 * file marshals buffers and messages and nothing else.
 *
 * NEAR-ZERO AudioParams. Measured on the sibling project: cutting a 16-voice synth from
 * 544 params to 96 took total audio processing from 5.94 ms to 2.31 ms. Parameters arrive
 * over `port.postMessage` and are applied at block boundaries.
 *
 * NO ALLOCATION AND NO LOGGING IN `process()`. And the whole body is wrapped: an uncaught
 * throw in `process()` silences the node PERMANENTLY, with no error and no recovery, so
 * the guard is not defensive style — it is the difference between one bad block and a
 * dead instrument.
 */

import type { EffectsState } from '../../../data/effectParams';
import { EffectChain, MAX_FX_BLOCK } from '../dsp/fx/effectChainCore';
import { VoiceEngine, type OscConfig } from '../voice/voiceEngineCore';
import type { SerializedOsc, SerializedProgram } from '../voiceMessages';

type InMessage =
  | { type: 'bank'; pcm: Float32Array }
  | { type: 'program'; program: SerializedProgram }
  | { type: 'effects'; effects: EffectsState }
  | { type: 'dacModel'; on: boolean }
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'joystick'; x: number; y: number }
  | { type: 'aftertouch'; value: number }
  | { type: 'allNotesOff' };

class VoiceProcessor extends AudioWorkletProcessor {
  private engine: VoiceEngine;
  /**
   * The master effect section, downstream of every voice.
   *
   * It lives HERE rather than inside VoiceEngine because it is genuinely a different stage:
   * the M1 sums all 16 oscillator slots into four effect buses and the effects run once on
   * the sum, not once per voice. Putting it in the engine would also make the Phase 2
   * golden-buffer tests measure the effects, which is precisely what they must not do.
   */
  private effects: EffectChain;
  /**
   * The whole factory bank as float, transferred ONCE. Programs then carry only offsets,
   * so a program change moves two 32 KB keymaps rather than 50 MiB of audio.
   */
  private pcm: Float32Array | null = null;
  /** Set false by the guard below if the engine ever throws, so it fails silent, not dead. */
  private healthy = true;

  constructor() {
    super();
    this.engine = new VoiceEngine(sampleRate);
    this.effects = new EffectChain(sampleRate);
    this.port.onmessage = (e: MessageEvent<InMessage>) => this.onMessage(e.data);
  }

  /**
   * Rebuild an oscillator's sample refs as views into the transferred blob.
   *
   * Every other field is spread through unchanged. Restating them one by one — which is
   * what this did before Phase 3 — makes adding an engine parameter a silent drop rather
   * than a compile error, because the wire type and the engine type are checked separately.
   * `SerializedOsc` is now `Omit<OscConfig, 'samples'>`, so the spread is exhaustive by
   * construction and `samples` is the only thing left to translate.
   */
  private hydrate(osc: SerializedOsc): OscConfig {
    const pcm = this.pcm;
    return {
      ...osc,
      samples: osc.samples.map((s) => ({
        // subarray, not slice: a view is free and the blob outlives every voice.
        data: pcm ? pcm.subarray(s.offset, s.offset + s.length) : new Float32Array(4),
        loopStart: s.loopStart,
        loopEnd: s.loopEnd,
        rootKey: s.rootKey,
        fineCents: s.fineCents,
        sampleRate: s.sampleRate,
      })),
    };
  }

  private onMessage(msg: InMessage): void {
    try {
      switch (msg.type) {
        case 'bank':
          this.pcm = msg.pcm;
          break;
        case 'program':
          this.engine.setProgram({
            ...msg.program,
            osc: [this.hydrate(msg.program.osc[0]), this.hydrate(msg.program.osc[1])],
          });
          break;
        case 'effects':
          this.effects.set(msg.effects);
          break;
        case 'dacModel':
          this.effects.setDacModel(msg.on);
          break;
        case 'joystick':
          this.engine.setJoystick(msg.x, msg.y);
          break;
        case 'aftertouch':
          this.engine.setAftertouch(msg.value);
          break;
        case 'noteOn':
          this.engine.noteOn(msg.note, msg.velocity);
          break;
        case 'noteOff':
          this.engine.noteOff(msg.note);
          break;
        case 'sustain':
          this.engine.setSustain(msg.down);
          break;
        case 'allNotesOff':
          this.engine.allNotesOff();
          // Kill the effect tails too. A panic that leaves a 9.9 s hall ringing has not
          // panicked; it has just stopped the notes.
          this.effects.reset();
          break;
      }
    } catch {
      // A malformed message must not take the node down with it.
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0]!;
    const r = out[1] ?? out[0]!;
    // READ the quantum, never assume 128. Web Audio 1.1's renderSizeHint ships in Chrome
    // M153, and a hardcoded 128 would render a fraction of a larger block and leave the
    // rest as silence.
    const count = l.length;

    if (!this.healthy) {
      l.fill(0);
      if (r !== l) r.fill(0);
      return true;
    }

    try {
      this.engine.render(l, r, count);
      // The effect section runs on the SUM of every voice, in its own fixed-size chunks.
      // Reading the host's quantum here would be the same mistake CLAUDE.md forbids on the
      // control path — and the chain's scratch buffers are sized once, at MAX_FX_BLOCK.
      for (let done = 0; done < count; done += MAX_FX_BLOCK) {
        const chunk = Math.min(MAX_FX_BLOCK, count - done);
        this.effects.process(l.subarray(done, done + chunk), r.subarray(done, done + chunk), chunk);
      }
    } catch {
      // Silence this block and every one after it, but KEEP RETURNING TRUE. Letting the
      // throw escape would permanently kill the node; this way the instrument goes quiet
      // and can be recovered by rebuilding the graph.
      this.healthy = false;
      l.fill(0);
      if (r !== l) r.fill(0);
    }
    return true;
  }
}

registerProcessor('borgm1-voice', VoiceProcessor);
