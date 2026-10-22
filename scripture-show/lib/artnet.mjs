// Art-Net (DMX over the network) sender: lets macros and triggers set lighting levels on an Art-Net node or desk.
import dgram from 'node:dgram';

const universes = new Map(); // "host|universe" -> Uint8Array(512) of current levels
let socket = null;
let seq = 0;

export function artDmxPacket(universe, data) {
  const len = Math.min(512, Math.max(2, data.length + (data.length % 2))); // even length, 2..512
  const buf = Buffer.alloc(18 + len);
  buf.write('Art-Net\0', 0, 'latin1');
  buf.writeUInt16LE(0x5000, 8);          // OpDmx
  buf.writeUInt16BE(14, 10);             // protocol version 14
  buf.writeUInt8((seq = (seq % 255) + 1), 12); // sequence 1..255
  buf.writeUInt8(0, 13);                 // physical port
  buf.writeUInt16LE(universe & 0x7fff, 14); // SubUni + Net
  buf.writeUInt16BE(len, 16);
  Buffer.from(data.slice(0, len)).copy(buf, 18);
  return buf;
}

// "1=255, 2=128, 10-12=64" -> { 1: 255, 2: 128, 10: 64, 11: 64, 12: 64 }
export function parseLevels(text) {
  const out = {};
  for (const part of String(text || '').split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,3})(?:-(\d{1,3}))?\s*[=:@]\s*(\d{1,3})%?$/.exec(part);
    if (!m) throw new Error(`Couldn't read “${part}” — use channel=value, e.g. 1=255 or 5-8=128`);
    const from = Number(m[1]), to = Number(m[2] || m[1]);
    let v = Number(m[3]); if (part.endsWith('%')) v = Math.round((v / 100) * 255);
    for (let ch = from; ch <= to; ch++) { if (ch < 1 || ch > 512) throw new Error('DMX channels are 1–512'); out[ch] = Math.min(255, v); }
  }
  return out;
}

// Set some channels (others keep their last value) and send; repeat a few times since DMX is sent over UDP.
export function sendLevels({ host, universe = 0, port = 6454 }, levels) {
  if (!host) throw new Error('Set the Art-Net node IP address in Settings → Lighting');
  const key = `${host}|${universe}`;
  const data = universes.get(key) || new Uint8Array(512);
  for (const [ch, v] of Object.entries(levels)) data[Number(ch) - 1] = v;
  universes.set(key, data);
  socket ||= dgram.createSocket('udp4');
  socket.on?.('error', () => {});
  const send = () => socket.send(artDmxPacket(Number(universe), data), port, host, () => {});
  send(); setTimeout(send, 100); setTimeout(send, 400);
  return { sent: Object.keys(levels).length };
}
