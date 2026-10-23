import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encoderArgs, hasFfmpeg, recordingName, startEncoder } from '../lib/encoder.mjs';

test('ffmpeg arguments for record, stream and both', () => {
  const rec = encoderArgs({ input: 'raw', width: 1280, height: 720, file: '/m/a.mp4' });
  assert.ok(rec.includes('rawvideo') && rec.includes('1280x720') && rec.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.equal(rec.at(-1), '/m/a.mp4');
  const both = encoderArgs({ input: 'webm', hasAudio: true, file: '/m/a.mp4', rtmp: 'rtmp://x/live/KEY' });
  assert.ok(both.includes('tee') && both.at(-1).includes('[f=flv:onfail=ignore]rtmp://x/live/KEY'));
  assert.ok(!both.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.ok(both.includes('0:a:0'));
  assert.throws(() => encoderArgs({}), /Nothing to do/);
  assert.throws(() => encoderArgs({ rtmp: 'http://x' }), /rtmp/);
  assert.equal(recordingName('Ch 1', 'mp4', new Date(2026, 9, 26, 9, 5)), 'Recording 2026-10-26 09-05 Ch 1.mp4');
});

test('raw frames become a playable MP4', { skip: !(await hasFfmpeg()) && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8rec-'));
  const file = path.join(dir, 'out.mp4');
  const enc = startEncoder({ input: 'raw', width: 320, height: 180, fps: 10, bitrate: 500, file });
  const frame = Buffer.alloc(320 * 180 * 4, 0x80);
  for (let i = 0; i < 20; i++) enc.write(frame);
  const info = await enc.stop();
  assert.equal(info.error, '');
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  assert.ok(dur > 1.5 && dur < 2.6, `duration ${dur}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
