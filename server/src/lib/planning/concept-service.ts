import type { MeasurementStatus } from "@stepchange/shared";
import { generateText } from "ai";
import type {
  FurnitureRequirement,
  Placement,
  TasteAttribute,
} from "../../db/schema.js";
import { MODELS } from "../ai.js";
import { describeFeature, roomSummaryLine } from "./brief-checks.js";
import { footprint } from "./geometry.js";
import type { FeatureInput, RoomGeometry } from "./types.js";

export const CONCEPT_PROMPT_VERSION = "concept-v1";

const BASIS_TEXT: Record<MeasurementStatus, string> = {
  user_confirmed: "verified (user-confirmed) room dimensions",
  source_printed: "room dimensions printed on the floor plan",
  calculated: "room dimensions calculated from a verified scale",
  estimated: "estimated room dimensions (not verified)",
  unknown: "inferred proportions (room dimensions unknown)",
};

// VS-002 / VS-005 disclosure shown with every concept.
export function buildDisclosure(
  basis: MeasurementStatus,
  photoUsed: boolean,
): string {
  return [
    "Indicative visual only: layout, lighting, structural features and exact product fit are not guaranteed.",
    `Based on ${BASIS_TEXT[basis]}.`,
    photoUsed
      ? "Generated from your photo of this room."
      : "No photo of this room was used, so this is generated from its description and will not look exactly like your room.",
    "Furniture shown is illustrative, not specific retailer products. Check the to-scale layout plan and measure before buying.",
  ].join(" ");
}

function positionPhrase(p: Placement, W: number, L: number) {
  const r = footprint(p);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.d / 2;
  const walls: string[] = [];
  if (r.y <= 15) walls.push("north");
  if (r.y + r.d >= L - 15) walls.push("south");
  if (r.x <= 15) walls.push("west");
  if (r.x + r.w >= W - 15) walls.push("east");
  if (walls.length) return `against the ${walls.join("/")} wall`;
  const ns = cy < L / 3 ? "north" : cy > (2 * L) / 3 ? "south" : "";
  const ew = cx < W / 3 ? "west" : cx > (2 * W) / 3 ? "east" : "";
  return ns || ew
    ? `towards the ${ns}${ns && ew ? "-" : ""}${ew} side`
    : "in the centre";
}

const TIER_TEXT = {
  practical:
    "Practical tier: durable, affordable, easy-care pieces; simple styling.",
  recommended:
    "Recommended tier: balanced quality and cost; considered styling.",
  aspirational:
    "Aspirational tier: premium materials and finishes; richer styling and layered lighting.",
} as const;

export function buildConceptPrompt(args: {
  room: RoomGeometry & { name: string; roomType: string };
  features: FeatureInput[];
  recommendedUse: string;
  requirements: FurnitureRequirement[];
  placements: Placement[];
  taste: TasteAttribute[];
  tasteSummary: string;
  vibe: string;
  tier: keyof typeof TIER_TEXT;
  photoUsed: boolean;
}): string {
  const { room } = args;
  const W = room.widthCm ?? 0;
  const L = room.lengthCm ?? 0;
  const likes = args.taste
    .filter((a) => !a.key.startsWith("avoid."))
    .map((a) => a.value);
  const avoid = args.taste
    .filter((a) => a.key.startsWith("avoid."))
    .map((a) => a.value);
  const reqById = new Map(args.requirements.map((r) => [r.id, r]));
  const furniture = args.placements.map((p) => {
    const r = reqById.get(p.requirementId);
    const where = W && L ? ` ${positionPhrase(p, W, L)}` : "";
    return `- ${p.label} (~${Math.round(p.widthCm)}×${Math.round(p.depthCm)}cm)${where}${r ? `: ${r.description}` : ""}`;
  });
  return [
    args.photoUsed
      ? "Transform the room in the attached photo into a furnished interior design concept. This must read as THIS room transformed."
      : `Create a photorealistic interior design concept of a ${room.roomType.replace(/_/g, " ")}.`,
    "HARD CONSTRAINTS: keep the existing architecture, window and door positions exactly; do not add structural changes, new windows, doors, walls or openings. Keep the camera viewpoint.",
    roomSummaryLine(room),
    `Architecture:\n${args.features.map((f) => `- ${describeFeature(f)}`).join("\n") || "- not recorded"}`,
    `Room purpose: ${args.recommendedUse}`,
    `Furniture layout (follow it; plan origin is the north-west corner):\n${furniture.join("\n") || "- as described in the purpose"}`,
    `Design direction: ${args.vibe}. ${TIER_TEXT[args.tier]}`,
    likes.length ? `Taste: ${likes.join(", ")}.` : "",
    args.tasteSummary ? `Taste summary: ${args.tasteSummary}` : "",
    avoid.length ? `Avoid: ${avoid.join(", ")}.` : "",
    "Use generic, unbranded furniture. No text, labels, logos or people in the image.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateConceptImage(
  prompt: string,
  photo: { bytes: Uint8Array; mediaType: string } | null,
): Promise<{ bytes: Uint8Array; mediaType: string; modelVersion: string }> {
  const result = await generateText({
    model: MODELS.image,
    messages: [
      {
        role: "user",
        content: [
          ...(photo
            ? [
                {
                  type: "file" as const,
                  mediaType: photo.mediaType,
                  data: photo.bytes,
                },
              ]
            : []),
          { type: "text" as const, text: prompt },
        ],
      },
    ],
    timeout: 150_000,
  });
  const image = result.files.find((f) => f.mediaType.startsWith("image/"));
  if (!image) throw new Error("The image model returned no image");
  return {
    bytes: image.uint8Array,
    mediaType: image.mediaType,
    modelVersion: result.response?.modelId ?? MODELS.image,
  };
}
