import type { Zone } from "@stepchange/shared";
import { isRug, isTall, isTransferTarget } from "./categories.js";
import {
  axisCandidates,
  footprint,
  gridStep,
  insideRoom,
  normaliseRotation,
  overlaps,
  type Rect,
  type Rotation,
} from "./geometry.js";
import type { LayoutItem } from "./types.js";
import {
  type ValidatorInput,
  type ValidatorResult,
  validateLayout,
} from "./validator.js";
import {
  accessibilityRequirements,
  chooseTurningZone,
  computeFixedZones,
  findTransferZones,
  zoneRect,
} from "./zones.js";

export type RepairMove = {
  requirementId: string;
  label: string;
  from: { xCm: number; yCm: number; rotationDeg: number };
  to: { xCm: number; yCm: number; rotationDeg: number };
};

const PRIORITY_RANK = { must: 0, should: 1, could: 2 } as const;
const ROTATION_PENALTY = 50;
const SOFT_ZONE_PENALTY = 200;

type Settled = { item: LayoutItem; rect: Rect };

// Deterministic repair: keep items that already sit legally, then move each
// conflicting item to the nearest legal position (optionally rotated by 90°).
// Items that cannot be placed legally stay where they were. Pure.
export function repairLayout(input: ValidatorInput): {
  items: LayoutItem[];
  moves: RepairMove[];
} {
  const { room, features, needs } = input;
  const W = room.widthCm;
  const L = room.lengthCm;
  if (W == null || L == null || W <= 0 || L <= 0) {
    return { items: input.items, moves: [] };
  }
  const req = accessibilityRequirements(needs);
  const fixed = computeFixedZones(W, L, features, req);
  const hardZones: Zone[] = fixed.zones.filter((z) => z.hard);
  const softZones: Zone[] = fixed.zones.filter((z) => !z.hard);

  if (req.turningDiameterCm) {
    const chosen = chooseTurningZone(
      W,
      L,
      req.turningDiameterCm,
      fixed.zones,
      input.items.map((it) => footprint(it)),
    );
    if (chosen) hardZones.push(chosen.zone);
  }

  const order = input.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority];
      if (p !== 0) return p;
      // Rugs last: they never block furniture, only zones.
      const rug =
        Number(isRug(a.item.category)) - Number(isRug(b.item.category));
      if (rug !== 0) return rug;
      const area =
        b.item.widthCm * b.item.depthCm - a.item.widthCm * a.item.depthCm;
      if (area !== 0) return area;
      return a.index - b.index;
    });

  const settled: Settled[] = [];
  const transferRects: Rect[] = [];
  const result = [...input.items];
  const moves: RepairMove[] = [];

  const needsTransfer = (it: LayoutItem) =>
    req.transfer !== undefined &&
    isTransferTarget(it.category, req.transfer.appliesTo);

  const legal = (it: LayoutItem, r: Rect, rotation: number): Rect[] | null => {
    if (!insideRoom(r, W, L)) return null;
    const rug = isRug(it.category);
    for (const z of hardZones) {
      if (rug && z.kind === "door_swing") continue;
      if (overlaps(r, zoneRect(z))) return null;
    }
    for (const t of transferRects) if (overlaps(r, t)) return null;
    for (const s of settled) {
      if (rug || isRug(s.item.category)) continue;
      if (overlaps(r, s.rect)) return null;
    }
    if (needsTransfer(it) && req.transfer) {
      const blockers = [
        ...hardZones.filter((z) => !z.accessibility).map(zoneRect),
        ...settled.map((s) => s.rect),
      ];
      const found = findTransferZones(
        W,
        L,
        r,
        rotation,
        req.transfer,
        blockers,
      );
      return found ?? null;
    }
    return [];
  };

  const softCost = (it: LayoutItem, r: Rect) => {
    let cost = 0;
    for (const z of softZones) {
      if (!overlaps(r, zoneRect(z))) continue;
      if (z.kind === "radiator_front" && !isRug(it.category))
        cost += SOFT_ZONE_PENALTY;
      if (z.kind === "window_front" && isTall(it.category, it.heightCm)) {
        cost += SOFT_ZONE_PENALTY;
      }
    }
    return cost;
  };

  const step = gridStep(W, L);

  for (const { item, index } of order) {
    const current = footprint(item);
    const here = legal(item, current, normaliseRotation(item.rotationDeg));
    if (here) {
      settled.push({ item, rect: current });
      transferRects.push(...here);
      continue;
    }
    const baseRot = normaliseRotation(item.rotationDeg);
    const rotations: Rotation[] = [baseRot, normaliseRotation(baseRot + 90)];
    let best: {
      x: number;
      y: number;
      rot: Rotation;
      cost: number;
      zones: Rect[];
    } | null = null;
    for (const rot of rotations) {
      const probe = footprint({ ...item, xCm: 0, yCm: 0, rotationDeg: rot });
      for (const x of axisCandidates(W, probe.w, step)) {
        for (const y of axisCandidates(L, probe.d, step)) {
          const r = { x, y, w: probe.w, d: probe.d };
          const cost =
            Math.abs(x - item.xCm) +
            Math.abs(y - item.yCm) +
            (rot === baseRot ? 0 : ROTATION_PENALTY) +
            softCost(item, r);
          if (best && cost >= best.cost) continue;
          const zones = legal(item, r, rot);
          if (zones) best = { x, y, rot, cost, zones };
        }
      }
    }
    if (best) {
      const moved: LayoutItem = {
        ...item,
        xCm: best.x,
        yCm: best.y,
        rotationDeg: best.rot,
      };
      result[index] = moved;
      settled.push({ item: moved, rect: footprint(moved) });
      transferRects.push(...best.zones);
      moves.push({
        requirementId: item.requirementId,
        label: item.label,
        from: { xCm: item.xCm, yCm: item.yCm, rotationDeg: item.rotationDeg },
        to: { xCm: best.x, yCm: best.y, rotationDeg: best.rot },
      });
    } else {
      settled.push({ item, rect: current });
    }
  }

  return { items: result, moves };
}

// Validate; if there are conflicts, repair and validate again.
export function validateWithRepair(input: ValidatorInput): {
  items: LayoutItem[];
  result: ValidatorResult;
} {
  const first = validateLayout(input);
  if (first.conflicts.length === 0)
    return { items: input.items, result: first };
  const { items, moves } = repairLayout(input);
  if (moves.length === 0) return { items: input.items, result: first };
  const second = validateLayout({ ...input, items });
  // Only accept the repair if it actually reduced conflicts.
  if (second.conflicts.length >= first.conflicts.length) {
    return { items: input.items, result: first };
  }
  return { items, result: { ...second, repairs: moves } };
}
