import { generateText, Output } from "ai";
import { z } from "zod";
import type { FurnitureRequirement, Placement } from "../../db/schema.js";
import { MODELS } from "../ai.js";
import { describeFeature, type PossessionInput } from "./brief-checks.js";
import { defaultFootprint, isFloorItem } from "./categories.js";
import { normaliseRotation } from "./geometry.js";
import { validateWithRepair } from "./repair.js";
import type {
  FeatureInput,
  LayoutItem,
  NeedInput,
  RoomGeometry,
} from "./types.js";
import { type ValidatorResult, validateLayout } from "./validator.js";
import { accessibilityRequirements, computeFixedZones } from "./zones.js";

export const LAYOUT_PROMPT_VERSION = "layout-v1";

type Unit = {
  requirement: FurnitureRequirement;
  label: string;
  widthCm: number;
  depthCm: number;
  heightCm: number | null;
  dimsKnown: boolean;
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// One unit per quantity for every floor-standing requirement, sized by the
// requirement's upper bounds (conservative envelope) or the kept item.
export function expandUnits(requirements: FurnitureRequirement[]): Unit[] {
  const units: Unit[] = [];
  for (const r of requirements) {
    if (!isFloorItem(r.category, r.description)) continue;
    const w = r.maxWidthCm ?? r.minWidthCm;
    const d = r.maxDepthCm;
    const def = defaultFootprint(r.category);
    for (let i = 0; i < r.quantity; i++) {
      units.push({
        requirement: r,
        label: r.quantity > 1 ? `${cap(r.category)} ${i + 1}` : cap(r.category),
        widthCm: w ?? def.widthCm,
        depthCm: d ?? def.depthCm,
        heightCm: r.maxHeightCm ?? null,
        dimsKnown: w !== undefined && d !== undefined,
      });
    }
  }
  return units;
}

export function toItems(
  placements: Placement[],
  requirements: FurnitureRequirement[],
): LayoutItem[] {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  return placements.map((p) => {
    const r = byId.get(p.requirementId);
    const w = r?.maxWidthCm ?? r?.minWidthCm;
    const d = r?.maxDepthCm;
    return {
      requirementId: p.requirementId,
      label: p.label,
      category: r?.category ?? p.label,
      priority: r?.priority ?? "should",
      xCm: p.xCm,
      yCm: p.yCm,
      widthCm: w ?? p.widthCm,
      depthCm: d ?? p.depthCm,
      rotationDeg: normaliseRotation(p.rotationDeg),
      heightCm: r?.maxHeightCm ?? null,
      dimsKnown: w !== undefined && d !== undefined,
    };
  });
}

export function toPlacements(items: LayoutItem[]): Placement[] {
  return items.map((it) => ({
    requirementId: it.requirementId,
    label: it.label,
    xCm: Math.round(it.xCm * 10) / 10,
    yCm: Math.round(it.yCm * 10) / 10,
    widthCm: it.widthCm,
    depthCm: it.depthCm,
    rotationDeg: normaliseRotation(it.rotationDeg),
  }));
}

const ProposalSchema = z.object({
  placements: z.array(
    z.object({
      unit: z.number().describe("Index of the unit in the list"),
      xCm: z.number(),
      yCm: z.number(),
      rotationDeg: z.number().describe("0, 90, 180 or 270"),
    }),
  ),
});

const INSTRUCTIONS = `You place furniture in a rectangular room plan. Coordinates are centimetres; origin is the north-west corner; x increases eastwards along the room width, y increases southwards along the room length.
(xCm, yCm) is the north-west corner of the item's footprint AFTER rotation; at 90/270 degrees the footprint is depth wide and width deep.
Hard rules: every item fully inside the room; no two items overlap (rugs may sit under furniture); never cover the listed keep-clear zones.
Prefer: large items against walls, seating facing the focal point, storage reachable, clear walking routes from doors.`;

export async function proposePlacements(args: {
  room: RoomGeometry & { name: string };
  features: FeatureInput[];
  needs: NeedInput[];
  units: Unit[];
}): Promise<{ items: LayoutItem[]; modelVersion: string | null }> {
  const { room, units } = args;
  const fallback = units.map((u) => unitToItem(u, 0, 0, 0));
  const W = room.widthCm;
  const L = room.lengthCm;
  if (W == null || L == null || units.length === 0) {
    return { items: fallback, modelVersion: null };
  }
  const fixed = computeFixedZones(
    W,
    L,
    args.features,
    accessibilityRequirements(args.needs),
  );
  const prompt = [
    `Room ${Math.round(W)} wide (x) × ${Math.round(L)} long (y) cm.`,
    `Features:\n${args.features.map((f) => `- ${describeFeature(f)}`).join("\n") || "- none"}`,
    `Keep-clear zones (x, y, width, depth):\n${
      fixed.zones
        .filter((z) => z.hard)
        .map(
          (z) => `- ${z.label}: ${z.xCm}, ${z.yCm}, ${z.widthCm}, ${z.depthCm}`,
        )
        .join("\n") || "- none"
    }`,
    accessibilityRequirements(args.needs).turningDiameterCm
      ? `Also leave one open ${accessibilityRequirements(args.needs).turningDiameterCm}cm square turning space in the main open area.`
      : "",
    `Units to place:\n${units
      .map(
        (u, i) =>
          `${i}: ${u.label} — ${u.widthCm} wide × ${u.depthCm} deep (${u.requirement.description})`,
      )
      .join("\n")}`,
  ].join("\n\n");
  try {
    const result = await generateText({
      model: MODELS.reasoning,
      instructions: INSTRUCTIONS,
      prompt,
      output: Output.object({ schema: ProposalSchema }),
      timeout: 90_000,
    });
    const items = [...fallback];
    for (const p of result.output.placements) {
      const u = units[p.unit];
      if (!u) continue;
      items[p.unit] = unitToItem(u, p.xCm, p.yCm, p.rotationDeg);
    }
    return {
      items,
      modelVersion: result.response?.modelId ?? MODELS.reasoning,
    };
  } catch (err) {
    // The deterministic repair still produces a legal layout where possible.
    console.error("layout proposal failed", err);
    return { items: fallback, modelVersion: null };
  }
}

function unitToItem(u: Unit, x: number, y: number, rot: number): LayoutItem {
  return {
    requirementId: u.requirement.id,
    label: u.label,
    category: u.requirement.category,
    priority: u.requirement.priority,
    xCm: x,
    yCm: y,
    widthCm: u.widthCm,
    depthCm: u.depthCm,
    rotationDeg: normaliseRotation(rot),
    heightCm: u.heightCm,
    dimsKnown: u.dimsKnown,
  };
}

export function runValidation(
  input: {
    room: RoomGeometry;
    features: FeatureInput[];
    needs: NeedInput[];
    items: LayoutItem[];
  },
  repair: boolean,
): { items: LayoutItem[]; result: ValidatorResult } {
  if (repair) return validateWithRepair(input);
  return { items: input.items, result: validateLayout(input) };
}

export type { PossessionInput };
