import type { Zone } from "@stepchange/shared";
import {
  axisCandidates,
  clamp,
  gridStep,
  insideRoom,
  overlapArea,
  overlaps,
  type Rect,
} from "./geometry.js";
import type { FeatureInput, NeedInput, WallSide } from "./types.js";

export const DEFAULT_DOOR_WIDTH_CM = 90;
export const DEFAULT_TURNING_DIAMETER_CM = 150;
export const DEFAULT_ROUTE_WIDTH_CM = 90;
export const DEFAULT_TRANSFER_WIDTH_CM = 90;
const WINDOW_FRONT_DEPTH_CM = 30;
const RADIATOR_FRONT_DEPTH_CM = 20;
const HEARTH_DEPTH_CM = 50;
const OBSTRUCTION_DEPTH_CM: Record<string, number> = {
  column: 30,
  built_in: 60,
  stairs: 90,
};

export function zoneRect(z: Zone): Rect {
  return { x: z.xCm, y: z.yCm, w: z.widthCm, d: z.depthCm };
}

function zone(
  kind: Zone["kind"],
  label: string,
  r: Rect,
  hard: boolean,
  accessibility: boolean,
): Zone {
  return {
    kind,
    label,
    xCm: r.x,
    yCm: r.y,
    widthCm: r.w,
    depthCm: r.d,
    hard,
    accessibility,
  };
}

// A rectangle hugging `wall`, starting `offset` along it, `along` long and
// reaching `depth` into the room. Clamped to the room.
export function wallRect(
  wall: WallSide,
  offset: number,
  along: number,
  depth: number,
  W: number,
  L: number,
): Rect {
  const alongSpan = wall === "north" || wall === "south" ? W : L;
  const a = clamp(along, 0, alongSpan);
  const o = clamp(offset, 0, alongSpan - a);
  const dep = clamp(depth, 0, wall === "north" || wall === "south" ? L : W);
  switch (wall) {
    case "north":
      return { x: o, y: 0, w: a, d: dep };
    case "south":
      return { x: o, y: L - dep, w: a, d: dep };
    case "west":
      return { x: 0, y: o, w: dep, d: a };
    case "east":
      return { x: W - dep, y: o, w: dep, d: a };
  }
}

function num(params: Record<string, unknown>, ...keys: string[]) {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string" && v.trim() !== "" && Number(v) > 0) {
      return Number(v);
    }
  }
  return undefined;
}

export type AccessibilityRequirements = {
  turningDiameterCm?: number;
  routeWidthCm?: number;
  transfer?: {
    widthCm: number;
    depthCm?: number;
    appliesTo?: string[];
    bothSides: boolean;
  };
  reach?: { minCm?: number; maxCm?: number };
};

// Folds confirmed needs into geometric requirements. Unconfirmed needs are
// never hard constraints (AC-003).
export function accessibilityRequirements(
  needs: NeedInput[],
): AccessibilityRequirements {
  const out: AccessibilityRequirements = {};
  for (const n of needs) {
    if (!n.confirmed) continue;
    const p = n.params ?? {};
    switch (n.needType) {
      case "turning_area": {
        const d =
          num(p, "turningDiameterCm", "diameterCm", "widthCm") ??
          DEFAULT_TURNING_DIAMETER_CM;
        out.turningDiameterCm = Math.max(out.turningDiameterCm ?? 0, d);
        break;
      }
      case "clear_route": {
        const w = num(p, "minWidthCm", "widthCm") ?? DEFAULT_ROUTE_WIDTH_CM;
        out.routeWidthCm = Math.max(out.routeWidthCm ?? 0, w);
        break;
      }
      case "mobility_aid": {
        const aid = num(p, "widthCm", "aidWidthCm");
        if (aid) out.routeWidthCm = Math.max(out.routeWidthCm ?? 0, aid + 20);
        const d = num(p, "turningDiameterCm", "diameterCm");
        if (d) out.turningDiameterCm = Math.max(out.turningDiameterCm ?? 0, d);
        break;
      }
      case "transfer_area": {
        const w = num(p, "widthCm", "minWidthCm") ?? DEFAULT_TRANSFER_WIDTH_CM;
        const appliesTo = Array.isArray(p.appliesTo)
          ? p.appliesTo.filter((a): a is string => typeof a === "string")
          : undefined;
        out.transfer = {
          widthCm: Math.max(out.transfer?.widthCm ?? 0, w),
          depthCm: num(p, "depthCm") ?? out.transfer?.depthCm,
          appliesTo: appliesTo ?? out.transfer?.appliesTo,
          bothSides: p.bothSides === true || out.transfer?.bothSides === true,
        };
        break;
      }
      case "reach_range": {
        const max = num(p, "reachMaxCm", "maxCm", "maxHeightCm");
        const min = num(p, "reachMinCm", "minCm", "minHeightCm");
        out.reach = {
          maxCm:
            max !== undefined
              ? Math.min(out.reach?.maxCm ?? Number.POSITIVE_INFINITY, max)
              : out.reach?.maxCm,
          minCm:
            min !== undefined
              ? Math.max(out.reach?.minCm ?? 0, min)
              : out.reach?.minCm,
        };
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export type FixedZonesResult = {
  zones: Zone[];
  unlocatedDoors: number;
  unknownFeatureNotes: string[];
  // Route zones blocked by fixed architecture cannot be repaired.
  obstructedRoutes: string[];
};

// Zones that depend only on the room, its features and confirmed needs.
export function computeFixedZones(
  W: number,
  L: number,
  features: FeatureInput[],
  req: AccessibilityRequirements,
): FixedZonesResult {
  const zones: Zone[] = [];
  const notes: string[] = [];
  let unlocatedDoors = 0;
  const routeZones: Zone[] = [];

  for (const f of features) {
    const located = f.wall != null && f.offsetCm != null;
    if (f.type === "door") {
      if (!located || !f.wall || f.offsetCm == null) {
        unlocatedDoors++;
        continue;
      }
      const dw = f.widthCm ?? DEFAULT_DOOR_WIDTH_CM;
      if (f.widthCm == null) {
        notes.push(
          `Door width on the ${f.wall} wall is unknown; assumed ${DEFAULT_DOOR_WIDTH_CM}cm.`,
        );
      }
      zones.push(
        zone(
          "door_swing",
          `Door swing (${f.wall} wall)`,
          wallRect(f.wall, f.offsetCm, dw, dw, W, L),
          true,
          false,
        ),
      );
      if (req.routeWidthCm) {
        const rw = req.routeWidthCm;
        const centre = f.offsetCm + dw / 2;
        const perpendicular = f.wall === "north" || f.wall === "south" ? L : W;
        const depth = Math.max(dw, perpendicular / 2);
        const r = zone(
          "clear_route",
          `Clear route ${rw}cm from ${f.wall} door`,
          wallRect(f.wall, centre - rw / 2, rw, depth, W, L),
          true,
          true,
        );
        zones.push(r);
        routeZones.push(r);
      }
      continue;
    }
    if (!located || !f.wall || f.offsetCm == null) {
      if (f.type !== "other") {
        notes.push(
          `The position of a ${f.type.replace("_", " ")} is unknown, so it could not be kept clear.`,
        );
      }
      continue;
    }
    const width = f.widthCm;
    switch (f.type) {
      case "window":
      case "bay_window":
        zones.push(
          zone(
            "window_front",
            `Window (${f.wall} wall)`,
            wallRect(
              f.wall,
              f.offsetCm,
              width ?? 120,
              WINDOW_FRONT_DEPTH_CM,
              W,
              L,
            ),
            false,
            false,
          ),
        );
        break;
      case "radiator":
        zones.push(
          zone(
            "radiator_front",
            `Radiator (${f.wall} wall)`,
            wallRect(
              f.wall,
              f.offsetCm,
              width ?? 100,
              RADIATOR_FRONT_DEPTH_CM,
              W,
              L,
            ),
            false,
            false,
          ),
        );
        break;
      case "fireplace": {
        const fw = width ?? 120;
        zones.push(
          zone(
            "hearth",
            `Fireplace hearth (${f.wall} wall)`,
            wallRect(f.wall, f.offsetCm, fw, HEARTH_DEPTH_CM, W, L),
            true,
            false,
          ),
        );
        break;
      }
      case "stairs":
      case "column":
      case "built_in": {
        const depth = OBSTRUCTION_DEPTH_CM[f.type] ?? 60;
        if (width == null) {
          notes.push(
            `The width of a ${f.type.replace("_", " ")} is unknown; assumed ${depth}cm.`,
          );
        }
        zones.push(
          zone(
            "obstruction",
            `${f.type === "built_in" ? "Built-in" : f.type === "stairs" ? "Stairs" : "Column"} (${f.wall} wall)`,
            wallRect(f.wall, f.offsetCm, width ?? depth, depth, W, L),
            true,
            false,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  const obstructedRoutes: string[] = [];
  for (const r of routeZones) {
    for (const z of zones) {
      if (z.kind !== "obstruction" && z.kind !== "hearth") continue;
      if (overlaps(zoneRect(r), zoneRect(z))) {
        obstructedRoutes.push(`${r.label} is blocked by ${z.label}.`);
      }
    }
  }

  return {
    zones,
    unlocatedDoors,
    unknownFeatureNotes: notes,
    obstructedRoutes,
  };
}

// Zones nothing may be placed over (fit or accessibility).
export function isBlockingZone(z: Zone) {
  return z.hard;
}

// Choose where the confirmed turning space goes: inside the room, clear of
// fixed architecture, overlapping as little furniture as possible, and as
// central as possible. Door swings and routes may overlap it (they are clear
// floor too).
export function chooseTurningZone(
  W: number,
  L: number,
  diameter: number,
  fixed: Zone[],
  items: Rect[],
): { zone: Zone; overlapCm2: number } | null {
  if (diameter > W + 0.5 || diameter > L + 0.5) return null;
  const step = gridStep(W, L);
  const blockers = fixed
    .filter((z) => z.kind === "obstruction" || z.kind === "hearth")
    .map(zoneRect);
  let best: { r: Rect; cost: number; dist: number } | null = null;
  const cx = W / 2;
  const cy = L / 2;
  for (const x of axisCandidates(W, diameter, step)) {
    for (const y of axisCandidates(L, diameter, step)) {
      const r = { x, y, w: diameter, d: diameter };
      if (blockers.some((b) => overlaps(r, b))) continue;
      let cost = 0;
      for (const it of items) cost += overlapArea(r, it);
      const dist =
        Math.abs(x + diameter / 2 - cx) + Math.abs(y + diameter / 2 - cy);
      if (
        !best ||
        cost < best.cost - 0.01 ||
        (Math.abs(cost - best.cost) <= 0.01 && dist < best.dist)
      ) {
        best = { r, cost, dist };
      }
    }
  }
  if (!best) return null;
  return {
    zone: zone(
      "turning_area",
      `Turning space ${diameter}cm`,
      best.r,
      true,
      true,
    ),
    overlapCm2: best.cost,
  };
}

// Candidate transfer rectangles beside an item's footprint: either end of its
// width axis (beside a bed's long side, at a sofa's arm).
export function transferCandidates(
  fp: Rect,
  rotationDeg: number,
  widthCm: number,
  depthCm?: number,
): Rect[] {
  const swapped = rotationDeg === 90 || rotationDeg === 270;
  if (!swapped) {
    const d = depthCm ?? fp.d;
    const y = fp.y + (fp.d - d) / 2;
    return [
      { x: fp.x - widthCm, y, w: widthCm, d },
      { x: fp.x + fp.w, y, w: widthCm, d },
    ];
  }
  const w = depthCm ?? fp.w;
  const x = fp.x + (fp.w - w) / 2;
  return [
    { x, y: fp.y - widthCm, w, d: widthCm },
    { x, y: fp.y + fp.d, w, d: widthCm },
  ];
}

export function findTransferZones(
  W: number,
  L: number,
  fp: Rect,
  rotationDeg: number,
  transfer: NonNullable<AccessibilityRequirements["transfer"]>,
  blockers: Rect[],
): Rect[] | null {
  const free = transferCandidates(
    fp,
    rotationDeg,
    transfer.widthCm,
    transfer.depthCm,
  ).filter((c) => insideRoom(c, W, L) && !blockers.some((b) => overlaps(c, b)));
  if (transfer.bothSides) return free.length === 2 ? free : null;
  const first = free[0];
  return first ? [first] : null;
}

export function transferZone(label: string, r: Rect): Zone {
  return zone("transfer_area", `Transfer space beside ${label}`, r, true, true);
}
