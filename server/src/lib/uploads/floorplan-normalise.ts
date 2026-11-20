import type {
  FloorplanDimension,
  FloorplanExtraction,
  MeasurementStatus,
} from "@stepchange/shared";

// Pure post-processing of the vision model's floor-plan output. The model is
// untrusted: this enforces FP-003 / FP-005 regardless of what it claims.
//
//  - source_printed only with a legible printed label (basis printed_label);
//  - estimated only from a legible scale bar / other printed dimensions, with
//    confidence capped at ESTIMATE_CONFIDENCE_CAP;
//  - anything else is unknown with no value (never inferred from pixels or
//    page size);
//  - implausible values are discarded.

export const ESTIMATE_CONFIDENCE_CAP = 0.5;

export const KNOWN_ROOM_TYPES = new Set([
  "living_room",
  "kitchen",
  "kitchen_diner",
  "dining_room",
  "bedroom",
  "bathroom",
  "en_suite",
  "wc",
  "hallway",
  "landing",
  "study",
  "utility",
  "conservatory",
  "garage",
  "storage",
  "other",
]);

const LIMITS = {
  maxFloors: 10,
  maxRooms: 60,
  maxFeaturesPerRoom: 30,
  maxLabels: 100,
  maxNotes: 20,
  roomDimMinCm: 50,
  roomDimMaxCm: 3000,
  featureDimMinCm: 20,
  featureDimMaxCm: 800,
} as const;

export type NormalisedDimension = {
  valueCm: number | null;
  status: MeasurementStatus;
  confidence: number | null;
};

export type NormalisedFeature = {
  type: FloorplanExtraction["rooms"][number]["features"][number]["type"];
  wall: "north" | "east" | "south" | "west" | null;
  width: NormalisedDimension;
  notes: string | null;
};

export type NormalisedRoom = {
  name: string;
  roomType: string;
  floorLevel: number;
  width: NormalisedDimension;
  length: NormalisedDimension;
  dimensionStatus: MeasurementStatus;
  features: NormalisedFeature[];
};

export type NormalisedExtraction = {
  floors: Array<{ name: string; level: number }>;
  rooms: NormalisedRoom[];
  labels: string[];
  needsKnownMeasurement: boolean;
  uncertaintyNotes: string[];
  warnings: string[];
};

const STATUS_RANK: Record<MeasurementStatus, number> = {
  user_confirmed: 4,
  source_printed: 3,
  calculated: 2,
  estimated: 1,
  unknown: 0,
};

/** The weaker (less certain) of two statuses. */
export function weakerStatus(
  a: MeasurementStatus,
  b: MeasurementStatus,
): MeasurementStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.min(1, Math.max(0, c));
}

function cleanText(s: string | null | undefined, max: number): string {
  return (s ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const UNKNOWN: NormalisedDimension = {
  valueCm: null,
  status: "unknown",
  confidence: null,
};

/** Apply FP-003 / FP-005 rules to one model-reported dimension. */
export function normaliseDimension(
  d: FloorplanDimension | null | undefined,
  range: { min: number; max: number },
): { dim: NormalisedDimension; implausible: boolean } {
  if (!d) return { dim: UNKNOWN, implausible: false };
  const value =
    typeof d.valueCm === "number" && Number.isFinite(d.valueCm)
      ? Math.round(d.valueCm * 10) / 10
      : null;
  if (value === null || d.status === "unknown") {
    return { dim: UNKNOWN, implausible: false };
  }
  if (value < range.min || value > range.max) {
    return { dim: UNKNOWN, implausible: true };
  }
  const confidence = clampConfidence(d.confidence);
  const fromScale =
    d.basis === "scale_bar" || d.basis === "other_printed_dimensions";

  if (d.status === "source_printed") {
    if (d.basis === "printed_label") {
      return {
        dim: { valueCm: value, status: "source_printed", confidence },
        implausible: false,
      };
    }
    if (fromScale) {
      return {
        dim: {
          valueCm: value,
          status: "estimated",
          confidence: Math.min(confidence, ESTIMATE_CONFIDENCE_CAP),
        },
        implausible: false,
      };
    }
    return { dim: UNKNOWN, implausible: false };
  }

  // status === "estimated"
  if (fromScale || d.basis === "printed_label") {
    return {
      dim: {
        valueCm: value,
        status: "estimated",
        confidence: Math.min(confidence, ESTIMATE_CONFIDENCE_CAP),
      },
      implausible: false,
    };
  }
  // No printed basis (e.g. pixels / page size): FP-005 forbids a value.
  return { dim: UNKNOWN, implausible: false };
}

export function normaliseRoomType(raw: string): string {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (KNOWN_ROOM_TYPES.has(t)) return t;
  const aliases: Record<string, string> = {
    lounge: "living_room",
    living: "living_room",
    reception: "living_room",
    reception_room: "living_room",
    sitting_room: "living_room",
    family_room: "living_room",
    kitchen_dining: "kitchen_diner",
    kitchen_dining_room: "kitchen_diner",
    dining: "dining_room",
    bed: "bedroom",
    master_bedroom: "bedroom",
    ensuite: "en_suite",
    shower_room: "bathroom",
    cloakroom: "wc",
    toilet: "wc",
    hall: "hallway",
    entrance_hall: "hallway",
    office: "study",
    utility_room: "utility",
    store: "storage",
    cupboard: "storage",
  };
  return aliases[t] ?? "other";
}

export class NotAFloorPlanError extends Error {
  constructor() {
    super("not_a_floor_plan");
  }
}

/** Normalise and bound the raw model output. Throws NotAFloorPlanError. */
export function normaliseExtraction(
  raw: FloorplanExtraction,
): NormalisedExtraction {
  if (!raw.isFloorPlan) throw new NotAFloorPlanError();
  const warnings: string[] = [];

  const floorsByLevel = new Map<number, { name: string; level: number }>();
  for (const f of raw.floors.slice(0, LIMITS.maxFloors)) {
    const level = Math.max(-3, Math.min(10, Math.trunc(f.level)));
    if (!floorsByLevel.has(level)) {
      floorsByLevel.set(level, {
        name: cleanText(f.name, 60) || defaultFloorName(level),
        level,
      });
    }
  }

  const rooms: NormalisedRoom[] = [];
  if (raw.rooms.length > LIMITS.maxRooms) {
    warnings.push(
      `Only the first ${LIMITS.maxRooms} rooms were imported; add any others manually.`,
    );
  }
  raw.rooms.slice(0, LIMITS.maxRooms).forEach((r, i) => {
    const name = cleanText(r.name, 80) || `Room ${i + 1}`;
    let level = Math.max(-3, Math.min(10, Math.trunc(r.floorLevel)));
    if (!floorsByLevel.has(level)) {
      if (floorsByLevel.size >= LIMITS.maxFloors) {
        level = floorsByLevel.keys().next().value ?? 0;
      } else {
        floorsByLevel.set(level, { name: defaultFloorName(level), level });
      }
    }
    const roomRange = { min: LIMITS.roomDimMinCm, max: LIMITS.roomDimMaxCm };
    const w = normaliseDimension(r.width, roomRange);
    const l = normaliseDimension(r.length, roomRange);
    if (w.implausible || l.implausible) {
      warnings.push(
        `A dimension read for "${name}" looked implausible and was discarded.`,
      );
    }
    const features: NormalisedFeature[] = r.features
      .slice(0, LIMITS.maxFeaturesPerRoom)
      .map((f) => ({
        type: f.type,
        wall: f.wall ?? null,
        width: normaliseDimension(f.widthCm, {
          min: LIMITS.featureDimMinCm,
          max: LIMITS.featureDimMaxCm,
        }).dim,
        notes: cleanText(f.notes, 200) || null,
      }));
    const dimensionStatus = weakerStatus(w.dim.status, l.dim.status);
    if (dimensionStatus === "unknown") {
      warnings.push(
        `Dimensions for "${name}" could not be read from the plan. Please measure this room.`,
      );
    } else if (dimensionStatus === "estimated") {
      warnings.push(
        `Dimensions for "${name}" are estimates from the plan's scale. Please confirm with a tape measure.`,
      );
    }
    rooms.push({
      name,
      roomType: normaliseRoomType(r.roomType),
      floorLevel: level,
      width: w.dim,
      length: l.dim,
      dimensionStatus,
      features,
    });
  });

  if (floorsByLevel.size === 0) {
    floorsByLevel.set(0, { name: defaultFloorName(0), level: 0 });
  }

  const needsKnownMeasurement =
    raw.needsKnownMeasurement ||
    rooms.some((r) => r.dimensionStatus !== "source_printed");

  const uncertaintyNotes = raw.uncertaintyNotes
    .map((n) => cleanText(n, 300))
    .filter(Boolean)
    .slice(0, LIMITS.maxNotes);
  if (needsKnownMeasurement && uncertaintyNotes.length === 0) {
    uncertaintyNotes.push(
      "The plan's scale could not be fully verified. Measure at least one wall so dimensions can be checked.",
    );
  }

  return {
    floors: [...floorsByLevel.values()].sort((a, b) => a.level - b.level),
    rooms,
    labels: raw.labels
      .map((s) => cleanText(s, 120))
      .filter(Boolean)
      .slice(0, LIMITS.maxLabels),
    needsKnownMeasurement,
    uncertaintyNotes,
    warnings,
  };
}

function defaultFloorName(level: number): string {
  if (level === 0) return "Ground floor";
  if (level === 1) return "First floor";
  if (level === 2) return "Second floor";
  if (level === 3) return "Third floor";
  if (level < 0)
    return level === -1 ? "Lower ground floor" : `Basement ${-level}`;
  return `Floor ${level}`;
}
