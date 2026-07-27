/**
 * PCM capture tap: a thin shell that copies its input (the master softClip fan-out) and
 * posts one transferable Float32Array-per-channel block to the main thread every render
 * quantum. The MasterRecorder accumulates the posted blocks, then encodeWav()s them at stop
 * for a lossless WAV download — parallel to the webm/opus MediaRecorder path.
 *
 * Thin-shell discipline: NO allocation or logging in the steady state of process(). One
 * message per block. The transfer detaches the posted buffers, so a FRESH Float32Array is
 * allocated for the NEXT block (the unavoidable reallocation) — done ONCE outside the
 * per-sample copy loop, never per sample.
 *
 * BLOCK SIZE IS READ, NOT ASSUMED (CLAUDE.md). Web Audio 1.1's `renderSizeHint` ships in
 * Chrome M153, so 128 is a default, not a guarantee. Slots are sized from the actual input
 * buffer length and only re-sized when that length changes — which in practice happens once,
 * on the first block, so the steady state still allocates nothing beyond the forced
 * post-transfer realloc.
 *
 * 1 input / 0 outputs (a pure sink). Returns true to stay alive while the node is connected;
 * the shell disconnects it on stop().
 */

const MAX_TAP_CHANNELS = 2;

class PcmTapProcessor extends AudioWorkletProcessor {
  /** Current slot length — the render quantum as observed, not as assumed. 0 until block 1. */
  private blockSize = 0;
  // Per-channel scratch buffers, reused across blocks; each one is REPLACED only after it has
  // been transferred away (postMessage detaches it). The msg envelope object is reused too —
  // only its `channels` array contents are swapped, never the wrapper.
  private slots: Float32Array[] = [];
  private readonly msg: { type: 'pcm'; channelCount: number; channels: Float32Array[] } = {
    type: 'pcm',
    channelCount: 0,
    channels: [],
  };
  // Preallocated, reused-across-blocks scratch arrays for the per-block postMessage: `out` holds
  // the channel slots to ship, `transfer` their backing buffers. Their LENGTH is reset to 0 at the
  // top of every process() and repopulated by push — no fresh array literal per render quantum.
  private readonly out: Float32Array[] = [];
  private readonly transfer: Transferable[] = [];

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const nCh = input.length < MAX_TAP_CHANNELS ? input.length : MAX_TAP_CHANNELS;

    // Size (or re-size) the slots to the ACTUAL quantum. Only runs on block 1 and on a quantum
    // change, so it is off the steady-state path.
    const frames = input[0]?.length ?? 0;
    if (frames === 0) return true;
    if (frames !== this.blockSize) {
      this.blockSize = frames;
      this.slots = [];
      for (let c = 0; c < MAX_TAP_CHANNELS; c++) this.slots.push(new Float32Array(frames));
    }

    const block = this.blockSize;
    const transfer = this.transfer;
    const out = this.out;
    transfer.length = 0;
    out.length = 0;
    for (let c = 0; c < nCh; c++) {
      const src = input[c];
      const slot = this.slots[c]!;
      if (src) {
        const n = src.length < block ? src.length : block;
        for (let i = 0; i < n; i++) slot[i] = src[i]!;
        for (let i = n; i < block; i++) slot[i] = 0;
      } else {
        for (let i = 0; i < block; i++) slot[i] = 0;
      }
      out.push(slot);
      transfer.push(slot.buffer as ArrayBuffer);
      // Reallocate THIS slot for the next block (the buffer about to be transferred detaches).
      // Done here, outside the sample-copy loop above — one alloc per channel per block, the
      // minimum the transfer model allows.
      this.slots[c] = new Float32Array(block);
    }
    this.msg.channelCount = nCh;
    this.msg.channels = out;
    this.port.postMessage(this.msg, transfer);
    return true;
  }
}

registerProcessor('borgm1-pcm-tap', PcmTapProcessor);
