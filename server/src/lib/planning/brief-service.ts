import { generateText, Output } from "ai";
import { z } from "zod";
import { MODELS } from "../ai.js";
import {
  type BriefDraft,
  describeFeature,
  postCheckBrief,
  roomSummaryLine,
} from "./brief-checks.js";
import type { RoomContext } from "./context.js";

export const BRIEF_PROMPT_VERSION = "brief-v1";

const DraftSchema = z.object({
  householdNeed: z.string(),
  roomConstraints: z.array(z.string()),
  recommendedUse: z.string(),
  requirements: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      quantity: z.number(),
      minWidthCm: z.number().nullable(),
      maxWidthCm: z.number().nullable(),
      maxDepthCm: z.number().nullable(),
      maxHeightCm: z.number().nullable(),
      priority: z.enum(["must", "should", "could"]),
      retainedPossessionId: z.string().nullable(),
      estimatedPriceLowGbp: z.number().nullable(),
      estimatedPriceHighGbp: z.number().nullable(),
    }),
  ),
  uncertainties: z.array(z.string()),
});

const INSTRUCTIONS = `You are a UK home-furnishing planner producing a FUNCTIONAL room brief before any styling.
Rules:
- Base the brief on the household's real needs, the room's measured constraints and the furniture they keep.
- Confirmed accessibility needs are hard constraints: leave the stated clear space, transfer space and reach limits.
- Size bounds (cm) must fit the room with circulation space; never exceed the room's dimensions. Use null when unknown.
- Existing possessions the household keeps MUST appear as requirements with their retainedPossessionId (price 0).
- Prices are realistic UK retail estimates in whole pounds (GBP) per item.
- Categories are short nouns (e.g. "sofa", "armchair", "coffee table", "media unit", "storage unit", "floor lamp", "rug", "bed", "wardrobe", "desk").
- Only list furniture and lighting needed for the recommended use; no decor-only items.
- If information is missing or uncertain, say so in uncertainties rather than guessing a verified fit.
- Do not invent names; refer to people by role and age only.`;

export function buildBriefPrompt(ctx: RoomContext): string {
  const { room, household, persons, possessions, features, needs } = ctx;
  const people = persons.map(
    (p) => `${p.role}${p.ageYears != null ? ` aged ${p.ageYears}` : ""}`,
  );
  const confirmed = needs.filter((n) => n.confirmed);
  return [
    `Room: ${room.name} (type: ${room.roomType})`,
    roomSummaryLine({ ...room }),
    room.heightCm
      ? `Ceiling height: ${Math.round(room.heightCm)}cm`
      : "Ceiling height: unknown",
    `Features:\n${features.length ? features.map((f) => `- ${describeFeature(f)}`).join("\n") : "- none recorded"}`,
    `Household members: ${people.length ? people.join("; ") : "not provided"}`,
    `Lifestyle: ${JSON.stringify(household.lifestyle ?? {})}`,
    `Practical needs: ${JSON.stringify(household.practicalNeeds ?? {})}`,
    `Confirmed accessibility needs (hard constraints):\n${
      confirmed.length
        ? confirmed
            .map((n) => `- ${n.needType}: ${JSON.stringify(n.params)}`)
            .join("\n")
        : "- none"
    }`,
    `Existing furniture to keep in this room:\n${
      possessions.length
        ? possessions
            .map(
              (p) =>
                `- id=${p.id} ${p.name} (${p.category}) ${p.widthCm ?? "?"}×${p.depthCm ?? "?"}×${p.heightCm ?? "?"}cm`,
            )
            .join("\n")
        : "- none"
    }`,
    ctx.roomBudgetPence != null
      ? `Indicative budget for this room: £${Math.round(ctx.roomBudgetPence / 100)} (household budget split across ${ctx.selectedRoomCount} selected rooms)`
      : "Budget: not set",
    "Produce the functional brief.",
  ].join("\n\n");
}

export async function draftBrief(ctx: RoomContext, allowUnreviewed: boolean) {
  const result = await generateText({
    model: MODELS.reasoning,
    instructions: INSTRUCTIONS,
    prompt: buildBriefPrompt(ctx),
    output: Output.object({ schema: DraftSchema }),
    timeout: 90_000,
  });
  const out = result.output;
  const draft: BriefDraft = {
    householdNeed: out.householdNeed,
    roomConstraints: out.roomConstraints,
    recommendedUse: out.recommendedUse,
    uncertainties: out.uncertainties,
    requirements: out.requirements.map((r) => ({
      category: r.category,
      description: r.description,
      quantity: r.quantity,
      minWidthCm: r.minWidthCm,
      maxWidthCm: r.maxWidthCm,
      maxDepthCm: r.maxDepthCm,
      maxHeightCm: r.maxHeightCm,
      priority: r.priority,
      retainedPossessionId: r.retainedPossessionId,
      estimatedPricePence:
        r.estimatedPriceLowGbp != null && r.estimatedPriceHighGbp != null
          ? {
              low: Math.round(r.estimatedPriceLowGbp * 100),
              high: Math.round(r.estimatedPriceHighGbp * 100),
            }
          : null,
    })),
  };
  const checked = postCheckBrief(draft, {
    room: { ...ctx.room, reviewed: ctx.room.reviewedAt != null },
    features: ctx.features,
    possessions: ctx.possessions,
    needs: ctx.needs,
    roomBudgetPence: ctx.roomBudgetPence,
    allowUnreviewed,
  });
  return {
    checked,
    modelVersion: result.response?.modelId ?? MODELS.reasoning,
  };
}
