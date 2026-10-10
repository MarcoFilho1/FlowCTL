// Draws the app icon (icons/source.png, 1024 px): three pixel nodes on a dark
// tile, done -> running -> pending, in the viewer's colors.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const N = 1024;
const px = new Uint8Array(N * N * 4);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const set = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  px.set([r, g, b, a], i);
};
// Tile: a rounded square with a 9% margin.
const m = 92, rad = 190, bg = hex("#1c2128");
for (let y = m; y < N - m; y++) for (let x = m; x < N - m; x++) {
  const cx = Math.min(Math.max(x, m + rad), N - m - rad), cy = Math.min(Math.max(y, m + rad), N - m - rad);
  if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) set(x, y, bg);
}
// Edges: Bresenham lines on the nodes' own 30 px pixel grid.
const k = 30, edge = hex("#8b949e");
const line = ([x0, y0], [x1, y1]) => {
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map((v) => Math.floor(v / k));
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    for (let py = 0; py < k; py++) for (let qx = 0; qx < k; qx++) set(x0 * k + qx, y0 * k + py, edge);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
};
// The same 8x8 disc as the tray icon and the viewer.
const disc = (cx, cy, color) => {
  const c = 3.5, r = 4 - 0.15;
  const inside = (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && (x - c) ** 2 + (y - c) ** 2 <= r * r;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (!inside(x, y)) continue;
    const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const d = x - c + y - c;
    const col = rim ? hex("#14161b") : d <= -3.36 ? mix(color, [255, 255, 255], 0.45) : d >= 3.04 ? mix(color, [0, 0, 0], 0.3) : color;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) set(cx - 4 * k + x * k + dx, cy - 4 * k + y * k + dy, col);
  }
};
const a = [330, 630], b = [690, 360], c = [690, 690];
line(a, b); line(a, c);
disc(...a, hex("#3fb950"));
disc(...b, hex("#4c8dff"));
disc(...c, hex("#e6edf3"));

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1);
writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
