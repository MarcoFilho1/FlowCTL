// Pixel-art pieces for the "pixel" style: a round node as a sprite of square
// pixels (outline, body, highlight, shade), and edges that step at right
// angles. Pure, so the sprites are tested without a browser.

/** One art pixel, in screen px: everything in pixel style snaps to this grid. */
export const PX = 2;

export type SpritePart = "outline" | "body" | "light" | "shade";

/** A sprite as one SVG path per part, in art pixels from its top-left corner. */
export type Sprite = Record<SpritePart, string>;

const sprites = new Map<number, Sprite>();

/**
 * A disc `size` art pixels across. Its rim is the outline; inside, the upper
 * left catches the light and the lower right falls into shade.
 */
export function discSprite(size: number): Sprite {
  const cached = sprites.get(size);
  if (cached) return cached;

  const c = (size - 1) / 2;
  const radius = size / 2 - 0.15;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && (x - c) ** 2 + (y - c) ** 2 <= radius ** 2;
  const parts: Record<SpritePart, string[]> = { outline: [], body: [], light: [], shade: [] };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const dx = x - c;
      const dy = y - c;
      const part: SpritePart = rim
        ? "outline"
        : dx + dy <= -(size * 0.42)
          ? "light"
          : dx + dy >= size * 0.38
            ? "shade"
            : "body";
      parts[part].push(`M${x} ${y}h1v1h-1z`);
    }
  }
  const sprite: Sprite = {
    outline: parts.outline.join(""),
    body: parts.body.join(""),
    light: parts.light.join(""),
    shade: parts.shade.join("")
  };
  sprites.set(size, sprite);
  return sprite;
}

/** The art pixels on a ring around a sprite, clockwise from the top: the running node's chaser. */
export function ringPixels(size: number, gap = 2): Array<[number, number]> {
  const c = (size - 1) / 2;
  const r = size / 2 + gap;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * 2 * Math.PI - Math.PI / 2;
    points.push([Math.round(c + r * Math.cos(angle)), Math.round(c + r * Math.sin(angle))]);
  }
  return points;
}

/** The "!" over a node that needs the person, in art pixels (1 wide, 4 tall with a gap). */
export const BANG = "M0 0h1v3h-1zM0 4h1v1h-1z";

/** Rounds a screen coordinate onto the art-pixel grid. */
export function snap(value: number): number {
  return Math.round(value / PX) * PX;
}

/**
 * A dependency as a stepped line: out of the source to the right, across at
 * the midpoint, into the target from the left. All corners are right angles.
 */
export function steppedPath(x1: number, y1: number, x2: number, y2: number): string {
  const a = { x: snap(x1), y: snap(y1) };
  const b = { x: snap(x2), y: snap(y2) };
  if (a.y === b.y) return `M ${a.x} ${a.y} H ${b.x}`;
  const mid = snap((a.x + b.x) / 2);
  return `M ${a.x} ${a.y} H ${mid} V ${b.y} H ${b.x}`;
}
