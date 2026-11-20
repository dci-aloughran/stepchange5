// Geometry for the to-scale room schematic (VS-004). Pure and unit-tested.
//
// Conventions match packages/shared/src/plan.ts: all values in cm, origin at
// the room's north-west corner, x east along the width, y south along the
// length. Feature offsets run from the west end (north/south walls) or the
// north end (east/west walls).

import type {
  ArchitecturalFeature,
  Layout,
  PlacementDto,
  Zone,
} from "@stepchange/shared";

export type Rect = { x: number; y: number; w: number; d: number };
export type Point = { x: number; y: number };
export type WallSide = "north" | "east" | "south" | "west";

export const DEFAULT_DOOR_WIDTH_CM = 90;

export type Frame = {
  widthCm: number;
  lengthCm: number;
  pad: number;
  viewBox: string;
  // Text and stroke sizes in cm so the drawing scales uniformly.
  fontSize: number;
  wallStroke: number;
  thinStroke: number;
  // A round scale-bar length (cm) that is <= ~1/3 of the width.
  scaleBarCm: number;
};

export function schematicFrame(widthCm: number, lengthCm: number): Frame {
  const span = Math.max(widthCm, lengthCm);
  const pad = Math.round(span * 0.08);
  const options = [25, 50, 100, 200, 500, 1000];
  const scaleBarCm =
    [...options].reverse().find((o) => o <= widthCm / 3) ?? options[0] ?? 25;
  return {
    widthCm,
    lengthCm,
    pad,
    // Extra room at the bottom for the scale bar.
    viewBox: `${-pad} ${-pad} ${widthCm + pad * 2} ${lengthCm + pad * 2.6}`,
    fontSize: Math.max(8, span / 30),
    wallStroke: Math.max(3, span / 80),
    thinStroke: Math.max(1, span / 300),
    scaleBarCm,
  };
}

// Footprint after rotation (90/270 swap width and depth).
export function placementRect(p: PlacementDto): Rect {
  const swapped = p.rotationDeg === 90 || p.rotationDeg === 270;
  return {
    x: p.xCm,
    y: p.yCm,
    w: swapped ? p.depthCm : p.widthCm,
    d: swapped ? p.widthCm : p.depthCm,
  };
}

export function zoneRect(z: Zone): Rect {
  return { x: z.xCm, y: z.yCm, w: z.widthCm, d: z.depthCm };
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.d / 2 };
}

// Wall start point, unit vector along the wall, and inward normal.
export function wallBasis(
  wall: WallSide,
  W: number,
  L: number,
): { start: Point; along: Point; inward: Point; length: number } {
  switch (wall) {
    case "north":
      return {
        start: { x: 0, y: 0 },
        along: { x: 1, y: 0 },
        inward: { x: 0, y: 1 },
        length: W,
      };
    case "south":
      return {
        start: { x: 0, y: L },
        along: { x: 1, y: 0 },
        inward: { x: 0, y: -1 },
        length: W,
      };
    case "west":
      return {
        start: { x: 0, y: 0 },
        along: { x: 0, y: 1 },
        inward: { x: 1, y: 0 },
        length: L,
      };
    case "east":
      return {
        start: { x: W, y: 0 },
        along: { x: 0, y: 1 },
        inward: { x: -1, y: 0 },
        length: L,
      };
  }
}

const add = (a: Point, b: Point, k = 1): Point => ({
  x: a.x + b.x * k,
  y: a.y + b.y * k,
});
const r1 = (n: number) => Math.round(n * 10) / 10;

export type FeatureShape = {
  id: string;
  type: ArchitecturalFeature["type"];
  wall: WallSide;
  // Opening segment along the wall.
  from: Point;
  to: Point;
  // Door leaf + swing arc path (doors only).
  swingPath: string | null;
  widthAssumed: boolean;
  label: string;
};

const FEATURE_DEFAULT_WIDTH: Partial<
  Record<ArchitecturalFeature["type"], number>
> = {
  door: DEFAULT_DOOR_WIDTH_CM,
  window: 120,
  bay_window: 180,
  radiator: 100,
  fireplace: 120,
  column: 30,
  built_in: 60,
  stairs: 90,
};

const FEATURE_LABEL: Record<ArchitecturalFeature["type"], string> = {
  door: "Door",
  window: "Window",
  bay_window: "Bay window",
  fireplace: "Fireplace",
  radiator: "Radiator",
  stairs: "Stairs",
  column: "Column",
  built_in: "Built-in",
  other: "Feature",
};

export function featureLabel(type: ArchitecturalFeature["type"]): string {
  return FEATURE_LABEL[type];
}

// Located features become shapes on their wall; unlocated ones return null
// (they are listed as text instead).
export function featureShape(
  f: Pick<
    ArchitecturalFeature,
    "id" | "type" | "wall" | "offsetCm" | "widthCm"
  >,
  W: number,
  L: number,
): FeatureShape | null {
  if (f.wall == null || f.offsetCm == null) return null;
  const basis = wallBasis(f.wall, W, L);
  const assumed = f.widthCm == null;
  const rawWidth = f.widthCm ?? FEATURE_DEFAULT_WIDTH[f.type] ?? 60;
  const width = Math.min(rawWidth, basis.length);
  const offset = Math.min(Math.max(0, f.offsetCm), basis.length - width);
  const from = add(basis.start, basis.along, offset);
  const to = add(basis.start, basis.along, offset + width);
  let swingPath: string | null = null;
  if (f.type === "door") {
    // Hinge at the start of the opening; leaf drawn open into the room.
    const leafEnd = add(from, basis.inward, width);
    const cross =
      basis.inward.x * basis.along.y - basis.inward.y * basis.along.x;
    const sweep = cross > 0 ? 1 : 0;
    swingPath = `M ${r1(from.x)} ${r1(from.y)} L ${r1(leafEnd.x)} ${r1(leafEnd.y)} A ${r1(width)} ${r1(width)} 0 0 ${sweep} ${r1(to.x)} ${r1(to.y)}`;
  }
  return {
    id: f.id,
    type: f.type,
    wall: f.wall,
    from,
    to,
    swingPath,
    widthAssumed: assumed,
    label: `${FEATURE_LABEL[f.type]} (${f.wall} wall)`,
  };
}

export type ZoneStyle = {
  fill: string;
  stroke: string;
  dashed: boolean;
  legend: string;
};

export const ZONE_STYLES: Record<Zone["kind"], ZoneStyle> = {
  door_swing: {
    fill: "rgba(230, 224, 213, 0.10)",
    stroke: "rgba(230, 224, 213, 0.45)",
    dashed: true,
    legend: "Door swing kept clear",
  },
  turning_area: {
    fill: "rgba(139, 195, 74, 0.16)",
    stroke: "#8bc34a",
    dashed: true,
    legend: "Wheelchair turning space",
  },
  clear_route: {
    fill: "rgba(120, 180, 230, 0.16)",
    stroke: "rgba(120, 180, 230, 0.8)",
    dashed: true,
    legend: "Clear route",
  },
  transfer_area: {
    fill: "rgba(190, 150, 230, 0.18)",
    stroke: "rgba(190, 150, 230, 0.85)",
    dashed: true,
    legend: "Transfer space",
  },
  obstruction: {
    fill: "rgba(167, 176, 169, 0.35)",
    stroke: "rgba(167, 176, 169, 0.8)",
    dashed: false,
    legend: "Obstruction",
  },
  hearth: {
    fill: "rgba(210, 140, 90, 0.25)",
    stroke: "rgba(210, 140, 90, 0.8)",
    dashed: false,
    legend: "Hearth",
  },
  window_front: {
    fill: "rgba(120, 180, 230, 0.08)",
    stroke: "rgba(120, 180, 230, 0.4)",
    dashed: true,
    legend: "In front of window",
  },
  radiator_front: {
    fill: "rgba(230, 150, 120, 0.10)",
    stroke: "rgba(230, 150, 120, 0.5)",
    dashed: true,
    legend: "In front of radiator",
  },
};

// Requirement ids involved in errors / warnings, for highlighting.
export function conflictSets(validation: Layout["validation"]): {
  errors: Set<string>;
  warnings: Set<string>;
} {
  const errors = new Set<string>();
  const warnings = new Set<string>();
  for (const c of validation?.conflicts ?? []) {
    if (c.requirementId) errors.add(c.requirementId);
  }
  for (const w of validation?.warnings ?? []) {
    if (w.requirementId && !errors.has(w.requirementId)) {
      warnings.add(w.requirementId);
    }
  }
  return { errors, warnings };
}

// Multiple units of one requirement share a requirementId; give each a
// stable key for React and the text list.
export function placementKeys(placements: PlacementDto[]): string[] {
  const seen = new Map<string, number>();
  return placements.map((p) => {
    const n = (seen.get(p.requirementId) ?? 0) + 1;
    seen.set(p.requirementId, n);
    return `${p.requirementId}#${n}`;
  });
}

// Short label that fits within a footprint at the given font size.
export function fitLabel(label: string, rect: Rect, fontSize: number): string {
  const maxChars = Math.max(
    0,
    Math.floor(Math.max(rect.w, rect.d) / (fontSize * 0.55)),
  );
  if (maxChars < 3) return "";
  return label.length <= maxChars
    ? label
    : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

// Where an item sits, in words (for the text alternative).
export function describePosition(r: Rect, W: number, L: number): string {
  const t = 15;
  const walls: string[] = [];
  if (r.y <= t) walls.push("north");
  if (r.y + r.d >= L - t) walls.push("south");
  if (r.x <= t) walls.push("west");
  if (r.x + r.w >= W - t) walls.push("east");
  if (walls.length) return `against the ${walls.join(" and ")} wall`;
  const c = rectCentre(r);
  const ns = c.y < L / 3 ? "north" : c.y > (2 * L) / 3 ? "south" : "";
  const ew = c.x < W / 3 ? "west" : c.x > (2 * W) / 3 ? "east" : "";
  return ns || ew ? `towards the ${ns}${ns && ew ? "-" : ""}${ew}` : "centre";
}

// Text alternative for the whole schematic.
export function describeLayout(
  layout: Pick<Layout, "placements" | "zones" | "validation" | "room">,
  features: Pick<ArchitecturalFeature, "type" | "wall">[] = [],
): string {
  const { widthCm: W, lengthCm: L } = layout.room;
  if (W == null || L == null) {
    return "Room size unknown, so the layout cannot be drawn to scale.";
  }
  const parts: string[] = [
    `Plan of a room ${Number((W / 100).toFixed(2))} metres wide (west to east) by ${Number((L / 100).toFixed(2))} metres long (north to south).`,
  ];
  const located = features.filter((f) => f.wall);
  if (located.length) {
    parts.push(
      `Features: ${located.map((f) => `${FEATURE_LABEL[f.type].toLowerCase()} on the ${f.wall} wall`).join(", ")}.`,
    );
  }
  if (layout.placements.length) {
    parts.push(
      `${layout.placements.length} item${layout.placements.length === 1 ? "" : "s"} placed: ${layout.placements
        .map((p) => {
          const r = placementRect(p);
          return `${p.label} (${Math.round(p.widthCm)} by ${Math.round(p.depthCm)} cm) ${describePosition(r, W, L)}`;
        })
        .join("; ")}.`,
    );
  } else {
    parts.push("No furniture placed yet.");
  }
  const reserved = layout.zones.filter((z) =>
    ["door_swing", "turning_area", "clear_route", "transfer_area"].includes(
      z.kind,
    ),
  );
  if (reserved.length) {
    parts.push(
      `Reserved clear space: ${reserved.map((z) => z.label).join(", ")}.`,
    );
  }
  const v = layout.validation;
  if (v) {
    parts.push(
      v.verifiedFit
        ? "Everything fits."
        : `Fit not verified: ${v.reasons.join(" ") || "see conflicts."}`,
    );
    if (v.conflicts.length) {
      parts.push(
        `${v.conflicts.length} conflict${v.conflicts.length === 1 ? "" : "s"}: ${v.conflicts.map((c) => c.message).join(" ")}`,
      );
    }
  }
  return parts.join(" ");
}

export function rotationLabel(deg: number): string {
  return deg === 0 ? "" : ` · rotated ${deg}°`;
}
