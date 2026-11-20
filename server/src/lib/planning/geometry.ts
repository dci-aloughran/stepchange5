// Axis-aligned geometry in cm. Origin = room north-west corner, x = east,
// y = south.

export type Rect = { x: number; y: number; w: number; d: number };

// Touching edges are not overlaps; sub-centimetre slivers are ignored.
export const EPS = 0.5;

export type Rotation = 0 | 90 | 180 | 270;

export function normaliseRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

export function footprint(p: {
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg: number;
}): Rect {
  const rot = normaliseRotation(p.rotationDeg);
  const swapped = rot === 90 || rot === 270;
  return {
    x: p.xCm,
    y: p.yCm,
    w: swapped ? p.depthCm : p.widthCm,
    d: swapped ? p.widthCm : p.depthCm,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS &&
    b.x < a.x + a.w - EPS &&
    a.y < b.y + b.d - EPS &&
    b.y < a.y + a.d - EPS
  );
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return w > EPS && d > EPS ? w * d : 0;
}

export function insideRoom(r: Rect, widthCm: number, lengthCm: number) {
  return (
    r.x >= -EPS &&
    r.y >= -EPS &&
    r.x + r.w <= widthCm + EPS &&
    r.y + r.d <= lengthCm + EPS
  );
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

// Candidate coordinates along one axis: a regular grid plus the far wall.
export function axisCandidates(span: number, size: number, step: number) {
  const max = span - size;
  if (max < -EPS) return [];
  if (max <= 0) return [0];
  const out: number[] = [];
  for (let v = 0; v < max; v += step) out.push(round1(v));
  out.push(round1(max));
  return out;
}

export function gridStep(widthCm: number, lengthCm: number) {
  return Math.max(5, Math.round(Math.max(widthCm, lengthCm) / 100));
}

export function round1(v: number) {
  return Math.round(v * 10) / 10;
}
