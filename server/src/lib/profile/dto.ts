import {
  type AccessibilityNeed,
  type ArchitecturalFeature,
  type Floor,
  type Home,
  type Household,
  JourneyStateSchema,
  LifestyleSchema,
  ListingSchema,
  type Measurement,
  type Person,
  PersonRoutinesSchema,
  type Possession,
  PracticalNeedsSchema,
  RetentionStateSchema,
  type Room,
  type UserProfile,
} from "@stepchange/shared";
import type { z } from "zod";
import type { schema } from "../../db/client.js";

// Row -> DTO mappers. Dates become ISO strings; jsonb columns are parsed
// against the shared schema and fall back to empty when stored data is
// malformed, so responses always match the shared contract.

type Select<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type UserRow = Select<typeof schema.users>;
export type HouseholdRow = Select<typeof schema.households>;
export type PersonRow = Select<typeof schema.persons>;
export type AccessibilityRow = Select<typeof schema.accessibilityNeeds>;
export type PossessionRow = Select<typeof schema.existingPossessions>;
export type HomeRow = Select<typeof schema.homes>;
export type FloorRow = Select<typeof schema.floors>;
export type RoomRow = Select<typeof schema.rooms>;
export type FeatureRow = Select<typeof schema.architecturalFeatures>;
export type MeasurementRow = Select<typeof schema.measurements>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

function parseOr<T extends z.ZodType>(
  s: T,
  value: unknown,
  fallback: z.infer<T>,
): z.infer<T> {
  const r = s.safeParse(value);
  return r.success ? r.data : fallback;
}

export function toUserProfile(u: UserRow): UserProfile {
  return {
    id: u.id,
    journeyType: u.journeyType,
    journeyState: parseOr(JourneyStateSchema, u.journeyState, {}),
    aiTrainingConsent: u.aiTrainingConsent,
    createdAt: iso(u.createdAt),
    updatedAt: iso(u.updatedAt),
  };
}

export function toHousehold(h: HouseholdRow): Household {
  return {
    id: h.id,
    name: h.name,
    lifestyle: parseOr(LifestyleSchema, h.lifestyle, {}),
    practicalNeeds: parseOr(PracticalNeedsSchema, h.practicalNeeds, {}),
    budgetTotalPence: h.budgetTotalPence,
    currency: h.currency,
    createdAt: iso(h.createdAt),
    updatedAt: iso(h.updatedAt),
  };
}

export function toPerson(p: PersonRow): Person {
  return {
    id: p.id,
    role: p.role,
    label: p.label,
    ageYears: p.ageYears,
    routines: parseOr(PersonRoutinesSchema, p.routines, {}),
    createdAt: iso(p.createdAt),
  };
}

export function toAccessibilityNeed(a: AccessibilityRow): AccessibilityNeed {
  return {
    id: a.id,
    scope: a.scope,
    roomId: a.roomId,
    personId: a.personId,
    needType: a.needType,
    params: a.params,
    confirmed: a.confirmed,
    notes: a.notes,
    createdAt: iso(a.createdAt),
  };
}

export function toPossession(p: PossessionRow): Possession {
  return {
    id: p.id,
    roomId: p.roomId,
    name: p.name,
    category: p.category,
    widthCm: p.widthCm,
    depthCm: p.depthCm,
    heightCm: p.heightCm,
    keep: p.keep,
    notes: p.notes,
    createdAt: iso(p.createdAt),
  };
}

export function toHome(h: HomeRow): Home {
  return {
    id: h.id,
    name: h.name,
    journeyType: h.journeyType,
    source: h.source,
    address: h.address,
    listing: parseOr(ListingSchema, h.listing, {}),
    retentionState: parseOr(RetentionStateSchema, h.retentionState, "active"),
    retainUntil: isoOrNull(h.retainUntil),
    createdAt: iso(h.createdAt),
    updatedAt: iso(h.updatedAt),
  };
}

export function toFloor(f: FloorRow): Floor {
  return {
    id: f.id,
    homeId: f.homeId,
    name: f.name,
    level: f.level,
    createdAt: iso(f.createdAt),
  };
}

export function toRoom(r: RoomRow): Room {
  return {
    id: r.id,
    homeId: r.homeId,
    floorId: r.floorId,
    name: r.name,
    roomType: r.roomType,
    selected: r.selected,
    widthCm: r.widthCm,
    lengthCm: r.lengthCm,
    heightCm: r.heightCm,
    dimensionStatus: r.dimensionStatus,
    polygon: r.polygon ?? null,
    reviewedAt: isoOrNull(r.reviewedAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function toFeature(f: FeatureRow): ArchitecturalFeature {
  return {
    id: f.id,
    roomId: f.roomId,
    type: f.type,
    wall: f.wall,
    offsetCm: f.offsetCm,
    widthCm: f.widthCm,
    heightCm: f.heightCm,
    status: f.status,
    notes: f.notes,
    createdAt: iso(f.createdAt),
  };
}

export function toMeasurement(m: MeasurementRow): Measurement {
  return {
    id: m.id,
    roomId: m.roomId,
    kind: m.kind,
    valueCm: m.valueCm,
    status: m.status,
    source: m.source,
    sourceUploadId: m.sourceUploadId,
    confidence: m.confidence,
    recordedAt: iso(m.recordedAt),
  };
}

// Latest measurement per kind; input may be in any order.
export function latestByKind(
  rows: MeasurementRow[],
): Record<string, Measurement> {
  const out: Record<string, MeasurementRow> = {};
  for (const m of rows) {
    const cur = out[m.kind];
    if (!cur || m.recordedAt.getTime() > cur.recordedAt.getTime()) {
      out[m.kind] = m;
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, m]) => [k, toMeasurement(m)]),
  );
}
