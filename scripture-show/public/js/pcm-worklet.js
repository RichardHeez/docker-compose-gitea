// Turns the mixer's output into 48 kHz stereo 16-bit PCM chunks (~100 ms) for the desktop recorder.
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(4800 * 2); this.n = 0; }
  process(inputs) {
    const inp = inputs[0]; if (!inp || !inp.length) return true;
    const l = inp[0], r = inp[1] || inp[0];
    for (let i = 0; i < l.length; i++) {
      this.buf[this.n * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
      this.buf[this.n * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      if (++this.n === 4800) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(4800 * 2); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
