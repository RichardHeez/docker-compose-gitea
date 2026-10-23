import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QUALITY, encoderArgs, hasFfmpeg, pickVideoEncoder, recordingName, startEncoder } from '../lib/encoder.mjs';

test('ffmpeg arguments for record, stream and both', () => {
  const rec = encoderArgs({ input: 'raw', width: 3840, height: 2160, file: '/m/a.mp4' });
  assert.ok(rec.includes('superfast') && rec.some((x) => x.endsWith('format=yuv420p')));
  assert.ok(rec.includes('rawvideo') && rec.includes('3840x2160') && rec.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.equal(rec.at(-1), '/m/a.mp4');
  const both = encoderArgs({ input: 'webm', hasAudio: true, file: '/m/a.mp4', rtmp: 'rtmp://x/live/KEY' });
  assert.ok(both.includes('tee') && both.at(-1).includes('[f=flv:onfail=ignore]rtmp://x/live/KEY'));
  assert.ok(!both.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.ok(both.includes('0:a:0'));
  const hw = encoderArgs({ file: '/m/a.mp4', videoEncoder: 'h264_nvenc' });
  assert.ok(hw.includes('h264_nvenc') && hw.some((x) => x.endsWith('format=nv12')));
  assert.throws(() => encoderArgs({}), /Nothing to do/);
  assert.throws(() => encoderArgs({ rtmp: 'http://x' }), /rtmp/);
  assert.equal(recordingName('Ch 1', 'mp4', new Date(2026, 9, 26, 9, 5)), 'Recording 2026-10-26 09-05 Ch 1.mp4');
});

test('raw frames become a playable MP4', { skip: !(await hasFfmpeg()) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8rec-'));
  const file = path.join(dir, 'out.mp4');
  const enc = await startEncoder({ input: 'raw', width: 320, height: 180, fps: 10, bitrate: 500, file });
  const frame = Buffer.alloc(320 * 180 * 4, 0x80);
  for (let i = 0; i < 20; i++) enc.write(frame);
  const info = await enc.stop();
  assert.equal(info.error, '');
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  assert.ok(dur > 1.5 && dur < 2.6, `duration ${dur}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('qualities start at 1080p and include 4K', async () => {
  assert.deepEqual(Object.keys(QUALITY), ['1080p', '4k']);
  assert.equal(QUALITY['4k'].width, 3840);
  if (await hasFfmpeg()) assert.match(await pickVideoEncoder(), /^(libx264|h264_\w+)$/);
});

test('4K frames encode to a 3840x2160 MP4', { skip: !(await hasFfmpeg()) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8rec4k-'));
  const file = path.join(dir, 'out.mp4');
  const enc = await startEncoder({ input: 'raw', ...QUALITY['4k'], fps: 10, file });
  const frame = Buffer.alloc(3840 * 2160 * 4, 0x40);
  for (let i = 0; i < 10; i++) { if (!enc.write(frame)) await new Promise((ok) => enc.proc.stdin.once('drain', ok)); }
  const info = await enc.stop();
  assert.equal(info.error, '');
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  assert.equal(out, '3840,2160');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('multistream and sound-input arguments', () => {
  const a = encoderArgs({ input: 'raw', file: '/m/a.mp4', rtmp: ['rtmp://yt/live2/K1', 'rtmps://fb:443/rtmp/K2'], audio: 'pcm', audioDelay: 120 });
  const tee = a.at(-1);
  assert.equal(tee.split('|').length, 3);
  assert.ok(tee.includes('rtmps://fb:443/rtmp/K2'));
  assert.ok(a.includes('pipe:3') && a.includes('s16le'));
  assert.ok(a.includes('adelay=delays=120:all=1'));
  assert.ok(!a.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.throws(() => encoderArgs({ rtmp: ['rtmp://a/x', 'rtmp://b/y|[f=mp4]/etc/x'] }), /rtmp/);
  assert.throws(() => encoderArgs({ rtmp: Array(7).fill('rtmp://a/b') }), /Up to 6/);
});

test('sound from the mixer is recorded with the picture', { skip: !(await hasFfmpeg()) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8pcm-'));
  const file = path.join(dir, 'out.mp4');
  const enc = await startEncoder({ input: 'raw', width: 320, height: 180, fps: 10, bitrate: 500, file, audio: 'pcm' });
  const frame = Buffer.alloc(320 * 180 * 4, 0x30);
  const pcm = Buffer.alloc(4800 * 4); // 100 ms of a 440 Hz tone, stereo s16le
  for (let i = 0; i < 4800; i++) { const v = Math.round(Math.sin((i / 48000) * 2 * Math.PI * 440) * 12000); pcm.writeInt16LE(v, i * 4); pcm.writeInt16LE(v, i * 4 + 2); }
  for (let i = 0; i < 20; i++) { enc.write(frame); enc.writeAudio(pcm); }
  const info = await enc.stop();
  assert.equal(info.error, '');
  const out = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${file}" -af volumedetect -vn -f null - 2>&1 | grep mean_volume`]).toString();
  const mean = Number(out.match(/mean_volume: (-?[\d.]+)/)[1]);
  assert.ok(mean > -20, `mean volume ${mean} dB`);
  fs.rmSync(dir, { recursive: true, force: true });
});
