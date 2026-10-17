// Phrase-by-phrase speech recognition through the server (/api/asr -> Khaya by GhanaNLP).
// Listens to the microphone, cuts the audio at natural pauses, and sends each phrase as a 16 kHz WAV.
// Results are delivered in the order they were spoken, even if transcriptions return out of order.
import { getPin } from './render.js';

const TARGET_RATE = 16000;

function toWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

function downsample(chunks, from) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  if (from === TARGET_RATE) return all;
  const ratio = from / TARGET_RATE;
  const out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) { // average each window (simple low-pass)
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = a; j < b; j++) sum += all[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

export class PhraseRecognizer {
  // onText(text) for each phrase, onLevel(0..1, speaking) for a meter, onError(message)
  constructor({ lang, onText, onLevel, onError, maxPhrase = 12, pauseMs = 650 }) {
    Object.assign(this, { lang, onText, onLevel: onLevel || (() => {}), onError: onError || console.warn, maxPhrase, pauseMs });
    this.seq = 0; this.nextOut = 0; this.done = new Map();
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const rate = this.ctx.sampleRate;
    const frameMs = (4096 / rate) * 1000;
    let noise = 0.005;          // running estimate of the room's noise floor
    let pre = [];               // ~0.4 s kept before speech starts
    let phrase = null;          // frames of the phrase being spoken
    let quietMs = 0;
    this.node.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const threshold = Math.max(0.012, noise * 3);
      const loud = rms > threshold;
      if (!loud && !phrase) noise = noise * 0.95 + rms * 0.05;
      this.onLevel(Math.min(1, rms / 0.2), !!phrase);
      if (!phrase) {
        pre.push(data); if (pre.length * frameMs > 400) pre.shift();
        if (loud) { phrase = [...pre]; pre = []; quietMs = 0; }
        return;
      }
      phrase.push(data);
      quietMs = loud ? 0 : quietMs + frameMs;
      const lengthMs = phrase.length * frameMs;
      if ((quietMs >= this.pauseMs && lengthMs > 900) || lengthMs >= this.maxPhrase * 1000) {
        const frames = phrase; phrase = null;
        if (lengthMs - quietMs > 350) this.send(downsample(frames, rate)); // ignore clicks and coughs
      }
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async send(samples) {
    const id = this.seq++;
    try {
      const headers = { 'content-type': 'audio/wav' };
      if (getPin()) headers['x-f8-pin'] = getPin();
      const r = await fetch(`/api/asr?lang=${encodeURIComponent(this.lang)}`, { method: 'POST', headers, body: toWav(samples, TARGET_RATE) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      this.done.set(id, body.text || '');
    } catch (e) {
      this.done.set(id, '');
      this.onError(e.message);
    }
    while (this.done.has(this.nextOut)) { // deliver in spoken order
      const t = this.done.get(this.nextOut); this.done.delete(this.nextOut++);
      if (t) this.onText(t);
    }
  }

  stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
  }
}
