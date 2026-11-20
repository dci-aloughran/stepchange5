import type {
  Conflict,
  LayoutValidationDto,
  NeedEvaluation,
  Zone,
} from "@stepchange/shared";
import { isRug, isStorage, isTall, isTransferTarget } from "./categories.js";
import { footprint, insideRoom, overlaps, type Rect } from "./geometry.js";
import {
  describeStatus,
  type FeatureInput,
  hasVerifiedDims,
  type LayoutItem,
  type NeedInput,
  type RoomGeometry,
} from "./types.js";
import {
  type AccessibilityRequirements,
  accessibilityRequirements,
  chooseTurningZone,
  computeFixedZones,
  findTransferZones,
  transferZone,
  zoneRect,
} from "./zones.js";

export type ValidatorInput = {
  room: RoomGeometry;
  features: FeatureInput[];
  needs: NeedInput[];
  items: LayoutItem[];
};

export type ValidatorResult = LayoutValidationDto & { zones: Zone[] };

const GEOMETRIC_NEEDS = new Set([
  "turning_area",
  "clear_route",
  "transfer_area",
  "reach_range",
  "mobility_aid",
]);

function conflict(
  code: Conflict["code"],
  message: string,
  item: LayoutItem | undefined,
  severity: Conflict["severity"],
  kind: Conflict["kind"],
): Conflict {
  return {
    code,
    message,
    severity,
    kind,
    ...(item ? { requirementId: item.requirementId, label: item.label } : {}),
  };
}

const PRIORITY_RANK = { must: 0, should: 1, could: 2 } as const;

// Deterministic layout validation (AC-003, AC-004, AC-005, D-005). Pure.
export function validateLayout(input: ValidatorInput): ValidatorResult {
  const { room, features, needs, items } = input;
  const conflicts: Conflict[] = [];
  const warnings: Conflict[] = [];
  const reasons: string[] = [];
  const notes: string[] = [];
  const needEvals: NeedEvaluation[] = [];
  const confirmed = needs.filter((n) => n.confirmed);
  const unconfirmed = needs.filter((n) => !n.confirmed);

  if (unconfirmed.length > 0) {
    notes.push(
      `${unconfirmed.length} accessibility need(s) are not confirmed and were not applied as hard constraints. Confirm them to include them.`,
    );
  }
  for (const n of confirmed) {
    if (!GEOMETRIC_NEEDS.has(n.needType)) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "not_assessed",
        message: `The ${n.needType.replace(/_/g, " ")} need is reflected in the brief but cannot be checked geometrically.`,
      });
    }
  }

  const W = room.widthCm;
  const L = room.lengthCm;
  if (W == null || L == null || W <= 0 || L <= 0) {
    reasons.push(
      "Room width and length are unknown. Measure the room (wall to wall) so fit can be checked; until then no fit or accessibility claim is made.",
    );
    for (const n of confirmed) {
      if (GEOMETRIC_NEEDS.has(n.needType)) {
        needEvals.push({
          needId: n.id,
          needType: n.needType,
          status: "not_evaluable",
          message: "Needs room measurements before it can be checked.",
        });
      }
    }
    return {
      verifiedFit: false,
      verifiedAccessible: false,
      conflicts,
      warnings,
      reasons,
      notes,
      needs: needEvals,
      repairs: [],
      zones: [],
    };
  }

  const req = accessibilityRequirements(needs);
  const fixed = computeFixedZones(W, L, features, req);
  notes.push(...fixed.unknownFeatureNotes);
  const zones: Zone[] = [...fixed.zones];
  const rects = items.map((it) => footprint(it));

  // ---- Item vs room and item vs item ----
  items.forEach((it, i) => {
    const r = rects[i] as Rect;
    if (!insideRoom(r, W, L)) {
      conflicts.push(
        conflict(
          "outside_room",
          `${it.label} extends beyond the room walls.`,
          it,
          "error",
          "fit",
        ),
      );
    }
  });
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as LayoutItem;
      const b = items[j] as LayoutItem;
      if (isRug(a.category) || isRug(b.category)) continue;
      if (!overlaps(rects[i] as Rect, rects[j] as Rect)) continue;
      // Attribute the conflict to the lower-priority item.
      const blame =
        PRIORITY_RANK[b.priority] >= PRIORITY_RANK[a.priority] ? b : a;
      const other = blame === b ? a : b;
      conflicts.push(
        conflict(
          "item_overlap",
          `${blame.label} overlaps ${other.label}.`,
          blame,
          "error",
          "fit",
        ),
      );
    }
  }

  // ---- Turning space (placed in the most open area) ----
  if (req.turningDiameterCm) {
    const d = req.turningDiameterCm;
    const chosen = chooseTurningZone(W, L, d, fixed.zones, rects);
    const evals = confirmed.filter(
      (n) =>
        n.needType === "turning_area" ||
        (n.needType === "mobility_aid" &&
          (n.params.turningDiameterCm != null || n.params.diameterCm != null)),
    );
    if (!chosen) {
      conflicts.push(
        conflict(
          "turning_area_unavailable",
          `There is no ${d}cm turning space clear of fixed features in this room.`,
          undefined,
          "error",
          "accessibility",
        ),
      );
      for (const n of evals) {
        needEvals.push({
          needId: n.id,
          needType: n.needType,
          status: "violated",
          message: `No ${d}cm turning space is possible in this room.`,
        });
      }
    } else {
      zones.push(chosen.zone);
      for (const n of evals) {
        needEvals.push({
          needId: n.id,
          needType: n.needType,
          status: chosen.overlapCm2 > 0 ? "violated" : "satisfied",
          message:
            chosen.overlapCm2 > 0
              ? `Furniture blocks the ${d}cm turning space.`
              : `A ${d}cm turning space is kept clear.`,
        });
      }
    }
  }

  // ---- Transfer spaces beside beds / seating ----
  const transferBlocked = new Set<number>();
  const zoneOwner = new Map<Zone, number>();
  if (req.transfer) {
    const transfer = req.transfer;
    const targets = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => isTransferTarget(it.category, transfer.appliesTo));
    const hardFixed = fixed.zones
      .filter((z) => z.hard && !z.accessibility)
      .map(zoneRect);
    for (const { it, i } of targets) {
      const blockers = [...hardFixed, ...rects.filter((_, j) => j !== i)];
      const found = findTransferZones(
        W,
        L,
        rects[i] as Rect,
        it.rotationDeg,
        transfer,
        blockers,
      );
      if (found) {
        for (const r of found) {
          const z = transferZone(it.label, r);
          zoneOwner.set(z, i);
          zones.push(z);
        }
      } else {
        transferBlocked.add(i);
        conflicts.push(
          conflict(
            "transfer_area_blocked",
            `${it.label} has no clear ${transfer.widthCm}cm transfer space beside it.`,
            it,
            "error",
            "accessibility",
          ),
        );
      }
    }
    for (const n of confirmed.filter((n) => n.needType === "transfer_area")) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status:
          targets.length === 0
            ? "satisfied"
            : transferBlocked.size > 0
              ? "violated"
              : "satisfied",
        message:
          targets.length === 0
            ? "No bed or seating in this layout needs a transfer space."
            : transferBlocked.size > 0
              ? "At least one bed or seat has no clear transfer space."
              : "Transfer space is kept clear beside each bed or seat.",
      });
    }
  }

  // ---- Items vs zones ----
  const routeOrZoneViolations = new Set<string>();
  items.forEach((it, i) => {
    const r = rects[i] as Rect;
    const rug = isRug(it.category);
    for (const z of zones) {
      // An item never conflicts with its own transfer space.
      if (zoneOwner.get(z) === i) continue;
      if (!overlaps(r, zoneRect(z))) continue;
      if (z.accessibility) {
        routeOrZoneViolations.add(z.kind);
        conflicts.push(
          conflict(
            "accessibility_zone_overlap",
            `${it.label} overlaps the confirmed ${z.label.toLowerCase()} (accessibility hard constraint).`,
            it,
            "error",
            "accessibility",
          ),
        );
      } else if (z.kind === "door_swing") {
        if (rug) {
          warnings.push(
            conflict(
              "rug_in_door_swing",
              `${it.label} lies in the door swing; check the door clears it.`,
              it,
              "warning",
              "fit",
            ),
          );
        } else {
          conflicts.push(
            conflict(
              "zone_overlap",
              `${it.label} blocks the ${z.label.toLowerCase()}.`,
              it,
              "error",
              "fit",
            ),
          );
        }
      } else if (z.hard) {
        conflicts.push(
          conflict(
            "zone_overlap",
            `${it.label} overlaps the ${z.label.toLowerCase()}.`,
            it,
            "error",
            "fit",
          ),
        );
      } else if (
        z.kind === "window_front" &&
        !rug &&
        isTall(it.category, it.heightCm)
      ) {
        warnings.push(
          conflict(
            "window_front",
            `${it.label} may block the ${z.label.toLowerCase()}; keep tall furniture away from windows.`,
            it,
            "warning",
            "fit",
          ),
        );
      } else if (z.kind === "radiator_front" && !rug) {
        warnings.push(
          conflict(
            "radiator_front",
            `${it.label} sits in front of the ${z.label.toLowerCase()} and may block heat.`,
            it,
            "warning",
            "fit",
          ),
        );
      }
    }
  });

  // ---- Clear routes ----
  if (req.routeWidthCm) {
    const evals = confirmed.filter(
      (n) =>
        n.needType === "clear_route" ||
        (n.needType === "mobility_aid" &&
          (n.params.widthCm != null || n.params.aidWidthCm != null)),
    );
    for (const msg of fixed.obstructedRoutes) {
      conflicts.push(
        conflict(
          "clear_route_obstructed",
          msg,
          undefined,
          "error",
          "accessibility",
        ),
      );
    }
    const doors = features.filter((f) => f.type === "door");
    const blocked =
      fixed.obstructedRoutes.length > 0 ||
      routeOrZoneViolations.has("clear_route");
    for (const n of evals) {
      if (doors.length === 0 || fixed.unlocatedDoors > 0) {
        needEvals.push({
          needId: n.id,
          needType: n.needType,
          status: "not_evaluable",
          message:
            doors.length === 0
              ? "No door is recorded for this room, so the route from the door cannot be checked."
              : "A door position is unknown, so the route from it cannot be checked.",
        });
      } else {
        needEvals.push({
          needId: n.id,
          needType: n.needType,
          status: blocked ? "violated" : "satisfied",
          message: blocked
            ? `The ${req.routeWidthCm}cm clear route from the door is blocked.`
            : `A ${req.routeWidthCm}cm clear route from each door is kept clear.`,
        });
      }
    }
  }

  // ---- Reach range (AC-004) ----
  evaluateReach(req, confirmed, items, conflicts, needEvals);

  // ---- Mobility aid without dimensions ----
  for (const n of confirmed) {
    if (
      n.needType === "mobility_aid" &&
      n.params.widthCm == null &&
      n.params.aidWidthCm == null &&
      n.params.turningDiameterCm == null &&
      n.params.diameterCm == null
    ) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "not_evaluable",
        message:
          "Add the mobility aid's width and turning space so the layout can be checked against it.",
      });
    }
  }

  // ---- Verdicts ----
  if (!hasVerifiedDims(room)) {
    reasons.push(
      `Room dimensions are ${describeStatus(room.dimensionStatus)}. Measure and confirm the room's width and length before relying on this fit.`,
    );
  }
  if (fixed.unlocatedDoors > 0) {
    reasons.push(
      `${fixed.unlocatedDoors} door position(s) are unknown. Add which wall each door is on and how far along it is so door swings can be kept clear.`,
    );
  }
  const unknownDims = items.filter((it) => !it.dimsKnown);
  if (unknownDims.length > 0) {
    reasons.push(
      `Sizes are not set for ${unknownDims.map((i) => i.label).join(", ")}; typical sizes were used. Set size limits or measure existing items to verify fit.`,
    );
  }
  if (conflicts.length > 0) {
    reasons.push(
      `${conflicts.length} layout conflict(s) remain. Move or remove the items listed to resolve them.`,
    );
  }
  const verifiedFit =
    hasVerifiedDims(room) &&
    fixed.unlocatedDoors === 0 &&
    unknownDims.length === 0 &&
    conflicts.length === 0;

  const geometricEvals = needEvals.filter((e) => e.status !== "not_assessed");
  let verifiedAccessible = verifiedFit;
  if (geometricEvals.length === 0) {
    verifiedAccessible = false;
    reasons.push(
      "No confirmed accessibility needs with measurable requirements apply to this room, so it is not labelled verified-accessible.",
    );
  } else if (geometricEvals.some((e) => e.status !== "satisfied")) {
    verifiedAccessible = false;
    const pending = geometricEvals.filter((e) => e.status !== "satisfied");
    reasons.push(
      `Confirmed accessibility needs not yet met or checkable: ${pending.map((e) => e.message).join(" ")}`,
    );
  } else if (!verifiedFit) {
    reasons.push("Accessibility cannot be verified until fit is verified.");
  }

  return {
    verifiedFit,
    verifiedAccessible,
    conflicts,
    warnings,
    reasons,
    notes,
    needs: needEvals,
    repairs: [],
    zones,
  };
}

function evaluateReach(
  req: AccessibilityRequirements,
  confirmed: NeedInput[],
  items: LayoutItem[],
  conflicts: Conflict[],
  needEvals: NeedEvaluation[],
) {
  const reachNeeds = confirmed.filter((n) => n.needType === "reach_range");
  if (reachNeeds.length === 0) return;
  const maxCm = req.reach?.maxCm;
  const storage = items.filter((it) => isStorage(it.category));
  if (maxCm === undefined || !Number.isFinite(maxCm)) {
    for (const n of reachNeeds) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "not_evaluable",
        message:
          "Add the maximum comfortable reach height so storage can be checked.",
      });
    }
    return;
  }
  const unknown = storage.filter((it) => it.heightCm == null);
  const tooHigh = storage.filter(
    (it) => it.heightCm != null && it.heightCm > maxCm,
  );
  for (const it of tooHigh) {
    conflicts.push(
      conflict(
        "reach_range",
        `${it.label} may be up to ${it.heightCm}cm tall, above the confirmed reach of ${maxCm}cm. Choose storage no taller than ${maxCm}cm for everyday items.`,
        it,
        "error",
        "accessibility",
      ),
    );
  }
  for (const n of reachNeeds) {
    if (tooHigh.length > 0) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "violated",
        message: `Some storage is taller than the confirmed ${maxCm}cm reach.`,
      });
    } else if (unknown.length > 0) {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "not_evaluable",
        message: `Heights are unknown for ${unknown.map((u) => u.label).join(", ")}, so reach cannot be verified.`,
      });
    } else {
      needEvals.push({
        needId: n.id,
        needType: n.needType,
        status: "satisfied",
        message: `Storage stays within the confirmed ${maxCm}cm reach.`,
      });
    }
  }
}
