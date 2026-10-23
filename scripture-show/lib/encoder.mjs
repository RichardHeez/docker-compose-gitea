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

const hideKey = (s, rtmp) => {
  if (!rtmp) return s;
  const key = rtmp.split('/').pop();
  return key && key.length > 3 ? String(s).split(key).join('••••') : s;
};

// Build the ffmpeg arguments. input: 'raw' (BGRA frames on stdin) or 'webm' (MediaRecorder stream on stdin).
export function encoderArgs({ input = 'webm', width = 1920, height = 1080, fps = 30, bitrate = 8000, hasAudio = false, file = '', rtmp = '', videoEncoder = 'libx264' } = {}) {
  if (!file && !rtmp) throw new Error('Nothing to do: choose recording, streaming or both');
  if (rtmp && !/^rtmps?:\/\/[^\s]+$/i.test(rtmp)) throw new Error('The stream address must start with rtmp:// or rtmps://');
  const a = ['-hide_banner', '-loglevel', 'error', '-nostats'];
  if (input === 'raw') a.push('-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0');
  else a.push('-fflags', '+genpts', '-i', 'pipe:0');
  const audioIn = input === 'raw' || !hasAudio;
  if (audioIn) a.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'); // streaming sites need an audio track
  a.push('-map', '0:v:0', '-map', audioIn ? '1:a:0' : '0:a:0');
  a.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=${videoEncoder === 'libx264' ? 'yuv420p' : 'nv12'}`);
  a.push(...videoCodecArgs(videoEncoder, width), '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`, '-g', String(fps * 2), '-keyint_min', String(fps * 2));
  a.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  if (audioIn) a.push('-shortest');
  const mp4 = 'movflags=+frag_keyframe+empty_moov+default_base_moof'; // playable even if the computer stops mid-service
  // tee (record + stream) needs the codec headers up front, or the MP4 has no decoder setup
  if (file && rtmp) a.push('-flags:v', '+global_header', '-flags:a', '+global_header', '-f', 'tee', `[f=mp4:${mp4}]${file}|[f=flv:onfail=ignore]${rtmp}`);
  else if (file) a.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', file);
  else a.push('-f', 'flv', rtmp);
  return a;
}

// Start an encoder. Returns { write(buf), stop(), info() }.
export async function startEncoder(opts) {
  const videoEncoder = opts.videoEncoder || await pickVideoEncoder();
  const args = encoderArgs({ ...opts, videoEncoder });
  const proc = spawn(ffmpegBinary(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const info = { started: Date.now(), bytes: 0, error: '', ended: false, file: opts.file || '', streaming: !!opts.rtmp, encoder: videoEncoder, size: `${opts.width}x${opts.height}` };
  let err = '';
  proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  proc.on('error', (e) => { info.error = e.code === 'ENOENT' ? 'ffmpeg is not installed on this computer' : e.message; info.ended = true; });
  proc.on('exit', (code) => { info.ended = true; if (code && !info.stopping) info.error = hideKey(err.trim().split('\n').pop() || `ffmpeg stopped (${code})`, opts.rtmp); });
  proc.stdin.on('error', () => {});
  return {
    write(buf) { if (info.ended || !proc.stdin.writable) return false; info.bytes += buf.length; return proc.stdin.write(buf); },
    stop() {
      return new Promise((resolve) => {
        if (info.ended) return resolve(info);
        info.stopping = true;
        proc.once('exit', () => resolve(info));
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
