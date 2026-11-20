import type { FurnitureRequirement } from "../../db/schema.js";
import {
  defaultFootprint,
  isFloorItem,
  isRug,
  isStorage,
} from "./categories.js";
import {
  describeStatus,
  type FeatureInput,
  hasVerifiedDims,
  type NeedInput,
  type Priority,
  type RoomGeometry,
} from "./types.js";
import { accessibilityRequirements } from "./zones.js";

export type DraftRequirement = {
  id?: string | null;
  category: string;
  description: string;
  quantity: number;
  minWidthCm?: number | null;
  maxWidthCm?: number | null;
  maxDepthCm?: number | null;
  maxHeightCm?: number | null;
  priority?: Priority | null;
  retainedPossessionId?: string | null;
  estimatedPricePence?: { low: number; high: number } | null;
};

export type BriefDraft = {
  householdNeed: string;
  roomConstraints: string[];
  recommendedUse: string;
  requirements: DraftRequirement[];
  uncertainties: string[];
};

export type PossessionInput = {
  id: string;
  name: string;
  category: string;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
};

export type BriefCheckContext = {
  room: RoomGeometry & { name: string; reviewed: boolean };
  features: FeatureInput[];
  possessions: PossessionInput[];
  needs: NeedInput[];
  roomBudgetPence: number | null;
  allowUnreviewed: boolean;
};

export type CheckedBrief = {
  householdNeed: string;
  recommendedUse: string;
  roomConstraints: string[];
  requirements: FurnitureRequirement[];
  uncertainties: string[];
};

const OVERCROWDING_RATIO = 0.55;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const positive = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : undefined;

export function formatPence(p: number) {
  return `£${Math.round(p / 100).toLocaleString("en-GB")}`;
}

export function describeFeature(f: FeatureInput): string {
  const name = f.type.replace("_", " ");
  if (!f.wall) return `${cap(name)} (position unknown)`;
  const parts: string[] = [];
  if (f.widthCm != null) parts.push(`${Math.round(f.widthCm)}cm wide`);
  if (f.offsetCm != null) {
    const from = f.wall === "north" || f.wall === "south" ? "west" : "north";
    parts.push(`${Math.round(f.offsetCm)}cm from the ${from} end`);
  }
  if (f.status !== "user_confirmed" && f.status !== "source_printed") {
    parts.push(describeStatus(f.status));
  }
  return `${cap(name)} on the ${f.wall} wall${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupe(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function roomSummaryLine(room: RoomGeometry): string {
  if (room.widthCm == null || room.lengthCm == null) {
    return "Room size: unknown (needs measuring)";
  }
  return `Room size: ${Math.round(room.widthCm)} × ${Math.round(room.lengthCm)} cm (${describeStatus(room.dimensionStatus)})`;
}

// Deterministic post-checks applied to every model-drafted or user-edited
// brief (FR-10, FR-11, AC-004, AC-005, FP-004). Pure.
export function postCheckBrief(
  draft: BriefDraft,
  ctx: BriefCheckContext,
): CheckedBrief {
  const { room } = ctx;
  const constraints: string[] = [roomSummaryLine(room)];
  const adjustments: string[] = [];
  const uncertainties: string[] = [...draft.uncertainties];

  for (const f of ctx.features) constraints.push(describeFeature(f));

  const req = accessibilityRequirements(ctx.needs);
  if (req.turningDiameterCm) {
    constraints.push(
      `Keep a ${req.turningDiameterCm}cm turning space clear (confirmed need)`,
    );
  }
  if (req.routeWidthCm) {
    constraints.push(
      `Keep a ${req.routeWidthCm}cm clear route from each door (confirmed need)`,
    );
  }
  if (req.transfer) {
    constraints.push(
      `Keep ${req.transfer.widthCm}cm transfer space beside beds and main seating (confirmed need)`,
    );
  }
  if (req.reach?.maxCm && Number.isFinite(req.reach.maxCm)) {
    constraints.push(
      `Everyday storage within ${req.reach.minCm ? `${req.reach.minCm}–` : ""}${req.reach.maxCm}cm reach height (confirmed need)`,
    );
  }

  // ---- Normalise requirements and ids ----
  const usedIds = new Set<string>();
  let counter = 0;
  const nextId = () => {
    let id: string;
    do {
      counter++;
      id = `req-${counter}`;
    } while (usedIds.has(id));
    return id;
  };
  const requirements: FurnitureRequirement[] = [];
  for (const d of draft.requirements) {
    const category = d.category.trim().slice(0, 60) || "item";
    let id = d.id?.trim();
    if (!id || !ID_RE.test(id) || usedIds.has(id)) id = nextId();
    usedIds.add(id);
    const r: FurnitureRequirement = {
      id,
      category,
      description: d.description.trim().slice(0, 500) || category,
      quantity: Math.min(20, Math.max(1, Math.round(d.quantity || 1))),
      priority: d.priority ?? "should",
    };
    const minW = positive(d.minWidthCm);
    const maxW = positive(d.maxWidthCm);
    const maxD = positive(d.maxDepthCm);
    const maxH = positive(d.maxHeightCm);
    if (minW !== undefined) r.minWidthCm = minW;
    if (maxW !== undefined) r.maxWidthCm = maxW;
    if (maxD !== undefined) r.maxDepthCm = maxD;
    if (maxH !== undefined) r.maxHeightCm = maxH;
    if (
      r.minWidthCm !== undefined &&
      r.maxWidthCm !== undefined &&
      r.minWidthCm > r.maxWidthCm
    ) {
      r.minWidthCm = r.maxWidthCm;
    }
    if (d.retainedPossessionId) r.retainedPossessionId = d.retainedPossessionId;
    if (d.estimatedPricePence) {
      const low = Math.max(0, Math.round(d.estimatedPricePence.low));
      const high = Math.max(0, Math.round(d.estimatedPricePence.high));
      r.estimatedPricePence = {
        low: Math.min(low, high),
        high: Math.max(low, high),
      };
    }
    requirements.push(r);
  }

  // ---- Retained possessions (FR-11) ----
  const possessions = new Map(ctx.possessions.map((p) => [p.id, p]));
  const linked = new Set<string>();
  for (const r of requirements) {
    const pid = r.retainedPossessionId;
    if (!pid) continue;
    if (!possessions.has(pid) || linked.has(pid)) {
      delete r.retainedPossessionId;
      continue;
    }
    linked.add(pid);
  }
  for (const p of ctx.possessions) {
    if (linked.has(p.id)) continue;
    const id = nextId();
    usedIds.add(id);
    requirements.push({
      id,
      category: p.category,
      description: `Keep your existing ${p.name}`,
      quantity: 1,
      priority: "must",
      retainedPossessionId: p.id,
    });
    adjustments.push(
      `Added your existing ${p.name} as a requirement it already satisfies`,
    );
  }
  for (const r of requirements) {
    const p = r.retainedPossessionId
      ? possessions.get(r.retainedPossessionId)
      : undefined;
    if (!p) continue;
    r.quantity = 1;
    r.priority = "must";
    r.estimatedPricePence = { low: 0, high: 0 };
    delete r.minWidthCm;
    delete r.maxWidthCm;
    delete r.maxDepthCm;
    delete r.maxHeightCm;
    const w = positive(p.widthCm);
    const dep = positive(p.depthCm);
    const h = positive(p.heightCm);
    if (w !== undefined) {
      r.minWidthCm = w;
      r.maxWidthCm = w;
    }
    if (dep !== undefined) r.maxDepthCm = dep;
    if (h !== undefined) r.maxHeightCm = h;
    if (w === undefined || dep === undefined) {
      uncertainties.push(
        `Measure your existing ${p.name} (width and depth) so we can check it fits.`,
      );
    }
  }

  // ---- Size bounds vs room (FR-10) ----
  const W = room.widthCm ?? undefined;
  const L = room.lengthCm ?? undefined;
  const H = room.heightCm ?? undefined;
  if (W && L) {
    const longest = Math.max(W, L);
    const shortest = Math.min(W, L);
    for (const r of requirements) {
      if (!isFloorItem(r.category, r.description)) continue;
      const retained = r.retainedPossessionId
        ? possessions.get(r.retainedPossessionId)
        : undefined;
      const w = r.maxWidthCm ?? r.minWidthCm;
      const d = r.maxDepthCm;
      const fitsEither = (a: number, b: number) =>
        (a <= W && b <= L) || (a <= L && b <= W);
      if (retained) {
        if (w !== undefined && d !== undefined && !fitsEither(w, d)) {
          uncertainties.push(
            `Your existing ${retained.name} (${w} × ${d} cm) may not fit in this room (${Math.round(W)} × ${Math.round(L)} cm).`,
          );
        }
        continue;
      }
      if (r.maxWidthCm !== undefined && r.maxWidthCm > longest) {
        adjustments.push(
          `${cap(r.category)}: maximum width reduced from ${r.maxWidthCm}cm to ${Math.floor(longest)}cm to fit the room`,
        );
        r.maxWidthCm = Math.floor(longest);
      }
      if (r.minWidthCm !== undefined && r.minWidthCm > longest) {
        uncertainties.push(
          `A ${r.category} at least ${r.minWidthCm}cm wide cannot fit this room; the requirement was reduced to ${Math.floor(longest)}cm.`,
        );
        r.minWidthCm = Math.floor(longest);
      }
      if (r.maxDepthCm !== undefined && r.maxDepthCm > longest) {
        adjustments.push(
          `${cap(r.category)}: maximum depth reduced from ${r.maxDepthCm}cm to ${Math.floor(longest)}cm to fit the room`,
        );
        r.maxDepthCm = Math.floor(longest);
      }
      const w2 = r.maxWidthCm ?? r.minWidthCm;
      const d2 = r.maxDepthCm;
      if (w2 !== undefined && d2 !== undefined && !fitsEither(w2, d2)) {
        const newDepth = Math.floor(shortest);
        adjustments.push(
          `${cap(r.category)}: maximum depth reduced from ${d2}cm to ${newDepth}cm so it fits the room in some orientation`,
        );
        r.maxDepthCm = newDepth;
      }
      if (H && r.maxHeightCm !== undefined && r.maxHeightCm > H) {
        adjustments.push(
          `${cap(r.category)}: maximum height reduced from ${r.maxHeightCm}cm to the ${Math.floor(H)}cm ceiling height`,
        );
        r.maxHeightCm = Math.floor(H);
      }
    }
  }

  // ---- Reach range (AC-004) ----
  const reachMax = req.reach?.maxCm;
  if (reachMax !== undefined && Number.isFinite(reachMax)) {
    for (const r of requirements) {
      if (!isStorage(r.category)) continue;
      const retained = r.retainedPossessionId
        ? possessions.get(r.retainedPossessionId)
        : undefined;
      if (retained) {
        if (r.maxHeightCm === undefined) {
          uncertainties.push(
            `Measure the height of your existing ${retained.name} to check it is within the confirmed ${reachMax}cm reach.`,
          );
        } else if (r.maxHeightCm > reachMax) {
          uncertainties.push(
            `Your existing ${retained.name} (${r.maxHeightCm}cm tall) is above the confirmed ${reachMax}cm reach; keep everyday items on lower shelves.`,
          );
        }
        continue;
      }
      if (r.maxHeightCm === undefined || r.maxHeightCm > reachMax) {
        adjustments.push(
          `${cap(r.category)}: maximum height set to ${reachMax}cm to stay within the confirmed reach range`,
        );
        r.maxHeightCm = reachMax;
      }
    }
  }

  // ---- Overcrowding ----
  if (W && L) {
    let covered = 0;
    for (const r of requirements) {
      if (!isFloorItem(r.category, r.description) || isRug(r.category))
        continue;
      const def = defaultFootprint(r.category);
      const w = r.maxWidthCm ?? r.minWidthCm ?? def.widthCm;
      const d = r.maxDepthCm ?? def.depthCm;
      covered += w * d * r.quantity;
    }
    const ratio = covered / (W * L);
    if (ratio > OVERCROWDING_RATIO) {
      uncertainties.push(
        `The listed furniture could cover about ${Math.round(ratio * 100)}% of the floor, which may leave too little space to move around. Consider fewer or smaller items.`,
      );
    }
  }

  // ---- Budget ----
  let low = 0;
  let high = 0;
  for (const r of requirements) {
    if (!r.estimatedPricePence) continue;
    low += r.estimatedPricePence.low * r.quantity;
    high += r.estimatedPricePence.high * r.quantity;
  }
  if (high > 0) {
    constraints.push(`Estimated cost ${formatPence(low)}–${formatPence(high)}`);
  }
  if (ctx.roomBudgetPence != null && ctx.roomBudgetPence > 0 && high > 0) {
    if (low > ctx.roomBudgetPence) {
      uncertainties.push(
        `The estimated cost (${formatPence(low)}–${formatPence(high)}) is above this room's share of your budget (about ${formatPence(ctx.roomBudgetPence)}). Consider keeping more existing items or lowering priorities.`,
      );
    } else if (high > ctx.roomBudgetPence) {
      constraints.push(
        `Upper cost estimate exceeds this room's budget share of about ${formatPence(ctx.roomBudgetPence)}`,
      );
    }
  }

  // ---- Measurement uncertainty (AC-005) and review state (FP-004) ----
  if (room.widthCm == null || room.lengthCm == null) {
    uncertainties.push(
      "Room width and length are unknown. Measure the room wall to wall so furniture sizes can be checked; sizes here are not verified.",
    );
  } else if (!hasVerifiedDims(room)) {
    uncertainties.push(
      `Room dimensions are ${describeStatus(room.dimensionStatus)}. Measure and confirm them before relying on these furniture sizes.`,
    );
  }
  if (!room.reviewed) {
    uncertainties.push(
      "This room's plan has not been reviewed yet. Check its size, doors, windows and obstructions before relying on this brief.",
    );
  }
  const unlocatedDoors = ctx.features.filter(
    (f) => f.type === "door" && (f.wall == null || f.offsetCm == null),
  ).length;
  if (unlocatedDoors > 0) {
    uncertainties.push(
      `${unlocatedDoors} door position(s) are unknown. Add which wall each door is on and where, so door swings can be kept clear.`,
    );
  }
  const unconfirmed = ctx.needs.filter((n) => !n.confirmed).length;
  if (unconfirmed > 0) {
    uncertainties.push(
      `${unconfirmed} accessibility need(s) are not confirmed, so they are not treated as hard constraints. Confirm them if they apply.`,
    );
  }

  return {
    householdNeed: draft.householdNeed.trim().slice(0, 2000),
    recommendedUse: draft.recommendedUse.trim().slice(0, 2000),
    roomConstraints: dedupe([
      ...constraints,
      ...draft.roomConstraints,
      ...adjustments,
    ]).slice(0, 40),
    requirements: requirements.slice(0, 40),
    uncertainties: dedupe(uncertainties).slice(0, 30),
  };
}
