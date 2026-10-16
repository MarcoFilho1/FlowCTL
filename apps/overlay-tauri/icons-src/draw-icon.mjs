// Draws the app icon (icons/source.png, 1024 px), the macOS icon's picture
// (apps/overlay/scripts/make-icon.swift) on a Windows tile: a graphite
// rounded square holding a small graph of pixel nodes, a finished green one
// feeding the blue one at work (glowing), with a pending one after it.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const N = 1024;
const px = new Float64Array(N * N * 4);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Paints over a pixel with `alpha` coverage (0..1). */
const blend = (x, y, [r, g, b], alpha = 1) => {
  if (x < 0 || y < 0 || x >= N || y >= N || alpha <= 0) return;
  const i = (y * N + x) * 4, a = Math.min(1, alpha), under = px[i + 3];
  const out = a + under * (1 - a);
  for (const [k, v] of [[0, r], [1, g], [2, b]]) px[i + k] = out === 0 ? 0 : (v * a + px[i + k] * under * (1 - a)) / out;
  px[i + 3] = out;
};

// The tile: Windows 11's app icons are rounded squares with a modest radius.
const m = 64, rad = 150;
const tile = (x, y) => {
  const cx = Math.min(Math.max(x, m + rad), N - m - rad), cy = Math.min(Math.max(y, m + rad), N - m - rad);
  return rad - Math.hypot(x - cx, y - cy);
};
const [top, mid, bottom] = [hex("#30353f"), hex("#1b1e25"), hex("#111318")];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const coverage = Math.min(1, Math.max(0, tile(x + 0.5, y + 0.5) + 0.5));
  if (coverage <= 0) continue;
  const t = (y - m) / (N - 2 * m);
  blend(x, y, t < 0.55 ? mix(top, mid, t / 0.55) : mix(mid, bottom, (t - 0.55) / 0.45), coverage);
}
// A faint dot grid: the overlay's canvas.
for (let gy = 116; gy <= 908; gy += 56) for (let gx = 116; gx <= 908; gx += 56)
  for (let y = gy - 5; y <= gy + 5; y++) for (let x = gx - 5; x <= gx + 5; x++)
    if (tile(x, y) > 8) blend(x, y, [255, 255, 255], 0.06 * Math.min(1, Math.max(0, 4.5 - Math.hypot(x - gx, y - gy))));

const done = { c: [258, 300], cell: 20, body: "#3fb950", light: "#9be9a8", shade: "#2a8a3b" };
const working = { c: [540, 548], cell: 38, body: "#4c8dff", light: "#a3c5ff", shade: "#3563b3" };
const pending = { c: [786, 780], cell: 18, body: "#e6e9ee", light: "#ffffff", shade: "#b4bac4" };

// The done edge: a round-capped stroke.
const stroke = ([x0, y0], [x1, y1], width, color, alpha) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let y = Math.min(y0, y1) - width; y <= Math.max(y0, y1) + width; y++) for (let x = Math.min(x0, x1) - width; x <= Math.max(x0, x1) + width; x++) {
    const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
    const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
    blend(x, y, color, alpha * Math.min(1, Math.max(0, width / 2 - d + 0.5)));
  }
};
stroke(done.c, working.c, 20, hex("#3fb950"), 0.85);
// The pending edge: round dots, as the viewer's dashed edge to a step not started.
{
  const [[x0, y0], [x1, y1]] = [working.c, pending.c];
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let t = 0; t <= len; t += 46) {
    const [dx, dy] = [x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len];
    for (let y = Math.floor(dy - 12); y <= dy + 12; y++) for (let x = Math.floor(dx - 12); x <= dx + 12; x++)
      blend(x, y, [255, 255, 255], 0.42 * Math.min(1, Math.max(0, 10.5 - Math.hypot(x - dx, y - dy))));
  }
}

// The working node glows, as a running node pulses in the viewer.
for (let y = working.c[1] - 330; y < working.c[1] + 330; y++) for (let x = working.c[0] - 330; x < working.c[0] + 330; x++) {
  const d = Math.hypot(x - working.c[0], y - working.c[1]);
  if (d < 330 && tile(x, y) > 0) blend(x, y, hex("#4c8dff"), 0.45 * (1 - d / 330) ** 1.6);
}

// The same 8x8 disc as the tray icon and the viewer, one cell per `cell` pixels.
const disc = ({ c: [cx, cy], cell, body, light, shade }) => {
  const rows = ["..oooo..", ".olbbbo.", "olbbbbbo", "obbbbbbo", "obbbbbbo", "obbbbbso", ".obbbso.", "..oooo.."];
  const colors = { o: hex("#0b0d11"), b: hex(body), l: hex(light), s: hex(shade) };
  rows.forEach((row, y) => [...row].forEach((part, x) => {
    if (part === ".") return;
    for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++)
      blend(Math.round(cx - 4 * cell + x * cell + dx), Math.round(cy - 4 * cell + y * cell + dy), colors[part]);
  }));
};
[done, pending, working].forEach(disc);

// A thin light rim, as the edge of Fluent's icons.
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const d = tile(x + 0.5, y + 0.5);
  if (d > 0 && d < 4) blend(x, y, [255, 255, 255], 0.14 * Math.min(1, d, 4 - d));
}

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) for (let i = 0; i < N * 4; i++) raw[y * (N * 4 + 1) + 1 + i] = Math.round(i % 4 === 3 ? px[y * N * 4 + i] * 255 : px[y * N * 4 + i]);
writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
