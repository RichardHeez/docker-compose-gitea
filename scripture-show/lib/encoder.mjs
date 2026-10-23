// Recording & streaming with ffmpeg. Video comes in either as raw BGRA frames (desktop app, from an
// off-screen output window) or as a WebM stream (browser screen capture). Out goes an MP4 file,
// an RTMP stream (YouTube, Facebook, Restream, vMix…) or both at once.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

export function ffmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static')?.replace('app.asar', 'app.asar.unpacked'); // packaged desktop app
    if (p && existsSync(p)) return p; // its download can fail on install; then use the system ffmpeg
  } catch { /* not installed */ }
  return 'ffmpeg';
}

let probe = null;
export function hasFfmpeg() {
  probe ||= new Promise((resolve) => {
    try {
      const p = spawn(ffmpegBinary(), ['-version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false)); p.on('exit', (c) => resolve(c === 0));
    } catch { resolve(false); }
  });
  return probe;
}

// Bitrates follow YouTube's live-streaming recommendations for 30 fps.
export const QUALITY = {
  '1080p': { width: 1920, height: 1080, bitrate: 8000 },
  '4k': { width: 3840, height: 2160, bitrate: 20000 },
};

// Use the graphics card's H.264 encoder when there is one that works (4K is too heavy for most CPUs);
// otherwise fall back to x264 on the processor. Each candidate is tried with a tiny test encode.
const HW = ['h264_nvenc', 'h264_qsv', 'h264_videotoolbox', 'h264_amf'];
let picked = null;
export function pickVideoEncoder() {
  if (process.env.F8_VIDEO_ENCODER) return Promise.resolve(process.env.F8_VIDEO_ENCODER);
  picked ||= (async () => {
    for (const enc of HW) {
      const ok = await new Promise((resolve) => {
        try {
          const p = spawn(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=0.2', '-frames:v', '3', '-vf', 'format=nv12', '-c:v', enc, '-f', 'null', '-'], { stdio: 'ignore' });
          const t = setTimeout(() => { p.kill(); resolve(false); }, 8000);
          p.on('error', () => { clearTimeout(t); resolve(false); });
          p.on('exit', (c) => { clearTimeout(t); resolve(c === 0); });
        } catch { resolve(false); }
      });
      if (ok) return enc;
    }
    return 'libx264';
  })();
  return picked;
}

function videoCodecArgs(enc, width) {
  const big = width > 1920;
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', enc, '-preset', 'p4', '-tune', 'll', '-rc', 'cbr'];
    case 'h264_qsv': return ['-c:v', enc, '-preset', 'veryfast'];
    case 'h264_videotoolbox': return ['-c:v', enc, '-realtime', '1'];
    case 'h264_amf': return ['-c:v', enc, '-usage', 'lowlatency', '-quality', 'speed'];
    default: return ['-c:v', 'libx264', '-preset', big ? 'superfast' : 'veryfast', '-tune', 'zerolatency'];
  }
}

// Never show stream keys in error messages.
const hideKeys = (s, urls) => urls.reduce((t, u) => { const key = u.split('/').pop(); return key && key.length > 3 ? t.split(key).join('••••') : t; }, String(s));
export const toList = (rtmp) => (Array.isArray(rtmp) ? rtmp : [rtmp]).map((u) => String(u || '').trim()).filter(Boolean);

// Build the ffmpeg arguments.
//   input: 'raw' (BGRA frames on stdin) or 'webm' (MediaRecorder stream on stdin)
//   audio: 'stream' (the WebM's own sound), 'pcm' (48 kHz stereo s16le on pipe 3, from the console's sound mixer) or 'none'
//   rtmp: one address or a list — every destination gets the same stream (multistream)
export function encoderArgs({ input = 'webm', width = 1920, height = 1080, fps = 30, bitrate = 8000, hasAudio = false, audio, audioDelay = 0,
  file = '', rtmp = '', videoEncoder = 'libx264' } = {}) {
  const dests = toList(rtmp);
  if (!file && !dests.length) throw new Error('Nothing to do: choose recording, streaming or both');
  if (dests.length > 6) throw new Error('Up to 6 stream destinations at once');
  for (const u of dests) if (!/^rtmps?:\/\/[^\s|\[\]]+$/i.test(u)) throw new Error('Each stream address must start with rtmp:// or rtmps://');
  audio ||= input === 'webm' && hasAudio ? 'stream' : 'none';
  const a = ['-hide_banner', '-loglevel', 'error', '-nostats'];
  if (input === 'raw') a.push('-thread_queue_size', '512', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0');
  else a.push('-fflags', '+genpts', '-i', 'pipe:0');
  if (audio === 'pcm') a.push('-thread_queue_size', '1024', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:3');
  else if (audio === 'none') a.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'); // streaming sites need an audio track
  a.push('-map', '0:v:0', '-map', audio === 'stream' ? '0:a:0' : '1:a:0');
  a.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=${videoEncoder === 'libx264' ? 'yuv420p' : 'nv12'}`);
  const delay = Math.max(0, Math.min(2000, Math.round(Number(audioDelay) || 0)));
  if (delay) a.push('-af', `adelay=delays=${delay}:all=1`); // line the sound up with the picture
  a.push(...videoCodecArgs(videoEncoder, width), '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`, '-g', String(fps * 2), '-keyint_min', String(fps * 2));
  a.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  if (audio !== 'stream') a.push('-shortest');
  const mp4 = 'movflags=+frag_keyframe+empty_moov+default_base_moof'; // playable even if the computer stops mid-service
  const outs = [...(file ? [`[f=mp4:${mp4}]${file}`] : []), ...dests.map((u) => `[f=flv:onfail=ignore]${u}`)];
  // tee (several outputs) needs the codec headers up front, or the MP4 has no decoder setup
  if (outs.length > 1) a.push('-flags:v', '+global_header', '-flags:a', '+global_header', '-f', 'tee', outs.join('|'));
  else if (file) a.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', file);
  else a.push('-f', 'flv', dests[0]);
  return a;
}

// Start an encoder. Returns { write(buf), writeAudio(buf), stop(), info() }.
export async function startEncoder(opts) {
  const videoEncoder = opts.videoEncoder || await pickVideoEncoder();
  const args = encoderArgs({ ...opts, videoEncoder });
  const dests = toList(opts.rtmp);
  const pcm = opts.audio === 'pcm';
  const proc = spawn(ffmpegBinary(), args, { stdio: ['pipe', 'ignore', 'pipe', ...(pcm ? ['pipe'] : [])] });
  const audioIn = pcm ? proc.stdio[3] : null;
  const info = { started: Date.now(), bytes: 0, error: '', ended: false, file: opts.file || '', streaming: dests.length > 0, destinations: dests.length,
    encoder: videoEncoder, size: `${opts.width}x${opts.height}`, audio: opts.audio || (opts.hasAudio ? 'stream' : 'none') };
  let err = '';
  proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  proc.on('error', (e) => { info.error = e.code === 'ENOENT' ? 'ffmpeg is not installed on this computer' : e.message; info.ended = true; });
  proc.on('exit', (code) => { info.ended = true; if (code && !info.stopping) info.error = hideKeys(err.trim().split('\n').pop() || `ffmpeg stopped (${code})`, dests); });
  proc.stdin.on('error', () => {});
  audioIn?.on('error', () => {});
  return {
    write(buf) { if (info.ended || !proc.stdin.writable) return false; info.bytes += buf.length; return proc.stdin.write(buf); },
    writeAudio(buf) { if (info.ended || !audioIn?.writable) return false; return audioIn.write(buf); },
    stop() {
      return new Promise((resolve) => {
        if (info.ended) return resolve(info);
        info.stopping = true;
        proc.once('exit', () => resolve(info));
        audioIn?.end();
        proc.stdin.end();
        setTimeout(() => { if (!info.ended) proc.kill('SIGINT'); }, 8000);
      });
    },
    info: () => ({ ...info, stopping: undefined }),
    proc,
  };
}

// No ffmpeg: a browser recording can still be saved as-is (WebM).
export function startPassthrough(file) {
  const out = createWriteStream(file);
  const info = { started: Date.now(), bytes: 0, error: '', ended: false, file, streaming: false };
  out.on('error', (e) => { info.error = e.message; info.ended = true; });
  return {
    write(buf) { if (info.ended) return false; info.bytes += buf.length; return out.write(buf); },
    stop: () => new Promise((resolve) => { if (info.ended) return resolve(info); out.end(() => { info.ended = true; resolve(info); }); }),
    info: () => ({ ...info }),
  };
}

export const recordingName = (label, ext = 'mp4', d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  const safe = String(label || 'F8').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'F8';
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())} ${safe}.${ext}`;
};
