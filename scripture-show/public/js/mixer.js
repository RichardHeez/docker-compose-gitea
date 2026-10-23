// Sound mixer for recording & streaming: the church's sound desk (any audio input — USB interface,
// mixer USB out, mic), plus extra sources such as the captured window's sound or remote guests.
// Output: a MediaStream audio track (browser recording) and/or raw PCM chunks (desktop recording).
export class Mixer {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.dest = this.ctx.createMediaStreamDestination();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.master.connect(this.dest); this.master.connect(this.analyser);
    this.sources = new Map(); // id -> { node, gain, stream, own }
    this.levels = new Float32Array(1024);
  }
  get track() { return this.dest.stream.getAudioTracks()[0]; }

  // Plug in a MediaStream (with audio) under an id; replaces an earlier one with the same id.
  add(id, stream, volume = 1, own = false) {
    this.remove(id);
    if (!stream?.getAudioTracks().length) return false;
    const node = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain(); gain.gain.value = volume;
    node.connect(gain).connect(this.master);
    this.sources.set(id, { node, gain, stream, own });
    return true;
  }
  remove(id) {
    const s = this.sources.get(id); if (!s) return;
    s.node.disconnect(); s.gain.disconnect();
    if (s.own) s.stream.getTracks().forEach((t) => t.stop());
    this.sources.delete(id);
  }
  setVolume(id, v) { const s = this.sources.get(id); if (s) s.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  has(id) { return this.sources.has(id); }

  // The sound desk input. Processing that suits phone calls (echo cancel, noise suppression,
  // auto gain) is switched off — it damages music.
  async setInput(deviceId, volume = 1) {
    if (!deviceId) { this.remove('input'); return null; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: deviceId === 'default' ? undefined : { exact: deviceId }, channelCount: { ideal: 2 }, sampleRate: 48000,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.add('input', stream, volume, true);
    return stream.getAudioTracks()[0].label;
  }

  // Peak level 0..1 for a meter.
  level() {
    this.analyser.getFloatTimeDomainData(this.levels);
    let peak = 0; for (const v of this.levels) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  async pcm(onChunk) {
    await this.ctx.audioWorklet.addModule('/js/pcm-worklet.js');
    const tap = new AudioWorkletNode(this.ctx, 'pcm-tap', { channelCount: 2, channelCountMode: 'explicit' });
    tap.port.onmessage = (e) => onChunk(e.data);
    this.master.connect(tap);
    return () => { try { this.master.disconnect(tap); } catch {} tap.port.onmessage = null; };
  }
  resume() { return this.ctx.resume(); }
}

export async function audioInputs() {
  let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  if (list.length && !list[0].label) { // labels appear after permission is granted once
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* keep generic names */ }
    list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }
  return list.map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
}
