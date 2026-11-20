import {
  type AccessibilityNeedInput,
  AccessibilityNeedInputSchema,
  type AccessibilityNeedType,
  type CreatePerson,
  type CreatePossession,
  type CreateRoom,
  type JourneyType,
  type Listing,
  type UpdateHousehold,
} from "@stepchange/shared";
import {
  type HomeBasics,
  type PlanRoom,
  type PropertyType,
  roomsFromFloorPlan,
} from "../rooms";
import type {
  JourneyData,
  JourneyDraft,
  LocalNeed,
  LocalPerson,
  LocalPossession,
} from "./types";

// Pure mapping between local journey answers and the server's DTOs.

// ---------------------------------------------------------------------------
// Numbers and money
// ---------------------------------------------------------------------------

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value ?? "")
    .replace(/[£,\s]/g, "")
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseCount(value: unknown, max = 50): number | undefined {
  const n = parseNumber(value);
  if (n == null || n < 0) return undefined;
  return Math.min(max, Math.round(n));
}

// "£6,000" / "6000" / "6k" → pence.
export function poundsToPence(value: unknown): number | null {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  const k = s.endsWith("k");
  const n = parseNumber(k ? s.slice(0, -1) : s);
  if (n == null || n < 0) return null;
  return Math.round(n * (k ? 1000 : 1) * 100);
}

export function formatPounds(pence: number | null | undefined): string {
  if (pence == null) return "";
  const pounds = pence / 100;
  return `£${pounds.toLocaleString("en-GB", {
    maximumFractionDigits: Number.isInteger(pounds) ? 0 : 2,
  })}`;
}

// Positive centimetres or null (server lengths must be > 0).
export function toCm(value: unknown): number | null {
  const n = parseNumber(value);
  return n != null && n > 0 && n <= 10_000 ? Math.round(n) : null;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function journeyTypeOf(data: JourneyData): JourneyType {
  return data.journey === "Buying a home" ? "buyer" : "homeowner";
}

export type HomePayload = {
  name: string;
  address: string | null;
  listing: Listing;
};

export function homePayload(data: JourneyData): HomePayload {
  const address = data.address?.trim() ?? "";
  const listing: Listing = {};
  const price = poundsToPence(data.price);
  if (price != null && price > 0) listing.pricePence = price;
  const area = parseNumber(data.area);
  if (area != null && area > 0 && area <= 10_000) listing.floorAreaSqm = area;
  const beds = parseCount(data.beds);
  if (beds !== undefined) listing.bedrooms = beds;
  const baths = parseCount(data.baths);
  if (baths !== undefined) listing.bathrooms = baths;
  return {
    name: (address || "My home").slice(0, 120),
    address: address ? address.slice(0, 300) : null,
    listing,
  };
}

// Key-order independent equality for plain JSON values.
export function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function homeChanged(
  server: { name: string; address: string | null; listing: Listing },
  desired: HomePayload,
): boolean {
  return (
    server.name !== desired.name ||
    (server.address ?? null) !== desired.address ||
    !sameJson(server.listing, desired.listing)
  );
}

// ---------------------------------------------------------------------------
// Household (lifestyle, practical needs, budget)
// ---------------------------------------------------------------------------

export function householdPayload(data: JourneyData): UpdateHousehold {
  const l = data.lifestyle ?? {};
  const lifestyle: NonNullable<UpdateHousehold["lifestyle"]> = {};
  if (l.wfhDaysPerWeek != null) {
    lifestyle.wfhDaysPerWeek = Math.min(7, Math.max(0, l.wfhDaysPerWeek));
  }
  for (const k of [
    "entertaining",
    "eatingTogether",
    "tvGaming",
    "cooking",
  ] as const) {
    if (l[k]) lifestyle[k] = l[k];
  }
  const hobbies = (l.hobbies ?? [])
    .map((h) => h.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 20);
  if (hobbies.length) lifestyle.hobbies = hobbies;
  if (l.childrensPlay != null) lifestyle.childrensPlay = l.childrensPlay;
  if (l.homework != null) lifestyle.homework = l.homework;
  if (l.notes?.trim()) lifestyle.notes = l.notes.trim().slice(0, 1000);

  const p = data.practical ?? {};
  const practicalNeeds: NonNullable<UpdateHousehold["practicalNeeds"]> = {};
  if (p.storageLevel) practicalNeeds.storageLevel = p.storageLevel;
  if (p.childSafety != null) practicalNeeds.childSafety = p.childSafety;
  if (p.petFriendlyMaterials != null) {
    practicalNeeds.petFriendlyMaterials = p.petFriendlyMaterials;
  }
  // Budget priorities, timing and things to find have no dedicated field;
  // they travel to the planner as practical-needs notes.
  const notes = [
    p.notes?.trim(),
    data.priorities?.length ? `Priorities: ${data.priorities.join(", ")}` : "",
    data.timing?.trim() ? `Timing: ${data.timing.trim()}` : "",
    data.find?.trim() ? `Need to find: ${data.find.trim()}` : "",
  ].filter(Boolean);
  if (notes.length) practicalNeeds.notes = notes.join("\n").slice(0, 1000);

  const pence = poundsToPence(data.budget);
  return {
    lifestyle,
    practicalNeeds,
    budgetTotalPence:
      pence == null ? null : Math.min(100_000_000, Math.max(0, pence)),
  };
}

export function householdChanged(
  server: {
    lifestyle: unknown;
    practicalNeeds: unknown;
    budgetTotalPence: number | null;
  },
  desired: UpdateHousehold,
): boolean {
  return (
    !sameJson(server.lifestyle, desired.lifestyle ?? {}) ||
    !sameJson(server.practicalNeeds, desired.practicalNeeds ?? {}) ||
    (server.budgetTotalPence ?? null) !== (desired.budgetTotalPence ?? null)
  );
}

// ---------------------------------------------------------------------------
// Persons (SE-007: role + age, no names needed)
// ---------------------------------------------------------------------------

const ROLE_WORD: Record<LocalPerson["role"], string> = {
  adult: "Adult",
  child: "Child",
  regular_visitor: "Visitor",
};

export function personLabel(people: LocalPerson[], person: LocalPerson) {
  const own = person.label?.trim();
  if (own) return own.slice(0, 60);
  const sameRole = people.filter((p) => p.role === person.role);
  const n = sameRole.findIndex((p) => p.id === person.id) + 1;
  return `${ROLE_WORD[person.role]} ${Math.max(1, n)}`;
}

export function personPayload(
  people: LocalPerson[],
  person: LocalPerson,
): Required<Pick<CreatePerson, "role" | "label" | "ageYears" | "routines">> {
  const routines: NonNullable<CreatePerson["routines"]> = {};
  if (person.role === "adult" && person.worksFromHome != null) {
    routines.worksFromHome = person.worksFromHome;
  }
  if (person.role === "child" && person.onTheWay) {
    routines.notes = "Baby on the way";
  }
  const age =
    person.role === "child" && person.onTheWay
      ? 0
      : person.ageYears == null
        ? null
        : Math.min(120, Math.max(0, Math.round(person.ageYears)));
  return {
    role: person.role,
    label: personLabel(people, person),
    ageYears: age,
    routines,
  };
}

export function personChanged(
  server: {
    role: string;
    label: string;
    ageYears: number | null;
    routines: unknown;
  },
  desired: ReturnType<typeof personPayload>,
) {
  return (
    server.role !== desired.role ||
    server.label !== desired.label ||
    (server.ageYears ?? null) !== desired.ageYears ||
    !sameJson(server.routines, desired.routines)
  );
}

// ---------------------------------------------------------------------------
// Accessibility needs (AC-001..AC-003)
// ---------------------------------------------------------------------------

export type NeedField = {
  key: string;
  label: string;
  kind: "cm" | "select" | "text";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
};

export type NeedTypeInfo = {
  type: AccessibilityNeedType;
  label: string;
  hint: string;
  fields: NeedField[];
};

const DETAILS: NeedField = {
  key: "details",
  label: "What helps (optional)",
  kind: "text",
  placeholder: "e.g. contrasting edges on steps",
};

export const NEED_TYPES: NeedTypeInfo[] = [
  {
    type: "turning_area",
    label: "Turning space",
    hint: "Clear floor space to turn a wheelchair or frame.",
    fields: [
      {
        key: "diameterCm",
        label: "Turning circle diameter (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 150",
      },
    ],
  },
  {
    type: "clear_route",
    label: "Clear route width",
    hint: "Minimum width of walkways between furniture.",
    fields: [
      {
        key: "minWidthCm",
        label: "Minimum route width (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 90",
      },
    ],
  },
  {
    type: "mobility_aid",
    label: "Mobility aid",
    hint: "The size of a wheelchair, frame or scooter used at home.",
    fields: [
      {
        key: "aidType",
        label: "Aid",
        kind: "select",
        options: [
          { value: "wheelchair", label: "Wheelchair" },
          { value: "powered_wheelchair", label: "Powered wheelchair" },
          { value: "walking_frame", label: "Walking frame" },
          { value: "rollator", label: "Rollator" },
          { value: "walking_stick", label: "Walking stick" },
          { value: "mobility_scooter", label: "Mobility scooter" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "widthCm",
        label: "Aid width (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 65",
      },
      {
        key: "lengthCm",
        label: "Aid length (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 105",
      },
    ],
  },
  {
    type: "transfer_area",
    label: "Transfer space",
    hint: "Space beside a bed, sofa or toilet to transfer safely.",
    fields: [
      {
        key: "widthCm",
        label: "Width (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 90",
      },
      {
        key: "depthCm",
        label: "Depth (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 120",
      },
      {
        key: "side",
        label: "Side",
        kind: "select",
        options: [
          { value: "either", label: "Either side" },
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
      },
    ],
  },
  {
    type: "reach_range",
    label: "Reach range",
    hint: "Heights that can be reached comfortably.",
    fields: [
      {
        key: "minCm",
        label: "Lowest comfortable reach (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 40",
      },
      {
        key: "maxCm",
        label: "Highest comfortable reach (cm)",
        kind: "cm",
        required: true,
        placeholder: "e.g. 120",
      },
    ],
  },
  {
    type: "step_free",
    label: "Step-free access",
    hint: "No steps or raised thresholds on key routes.",
    fields: [DETAILS],
  },
  {
    type: "trip_hazard_avoidance",
    label: "Avoid trip hazards",
    hint: "No loose rugs, trailing cables or low clutter on routes.",
    fields: [DETAILS],
  },
  {
    type: "seating_support",
    label: "Supportive seating",
    hint: "Firm seats, arms or a set seat height.",
    fields: [DETAILS],
  },
  {
    type: "visual",
    label: "Seeing",
    hint: "Contrast, lighting and clear edges.",
    fields: [DETAILS],
  },
  {
    type: "hearing",
    label: "Hearing",
    hint: "Visual alerts or quieter spaces.",
    fields: [DETAILS],
  },
  {
    type: "dexterity",
    label: "Grip and dexterity",
    hint: "Easy handles, light doors, simple controls.",
    fields: [DETAILS],
  },
  {
    type: "cognitive",
    label: "Simple, consistent layout",
    hint: "Predictable places for things, clear routes.",
    fields: [DETAILS],
  },
  {
    type: "sensory",
    label: "Calm, low-stimulus space",
    hint: "Somewhere quiet with softer light and fewer patterns.",
    fields: [DETAILS],
  },
];

export function needTypeInfo(type: AccessibilityNeedType): NeedTypeInfo {
  return NEED_TYPES.find((t) => t.type === type) ?? (NEED_TYPES[0] as never);
}

// Short human summary, e.g. "Turning space 150 cm".
export function needSummary(need: LocalNeed): string {
  const info = needTypeInfo(need.needType);
  const p = need.params;
  const cm = (k: string) => (p[k] != null && p[k] !== "" ? `${p[k]} cm` : "");
  switch (need.needType) {
    case "turning_area":
      return [info.label, cm("diameterCm")].filter(Boolean).join(" ");
    case "clear_route":
      return [info.label, cm("minWidthCm")].filter(Boolean).join(" ");
    case "mobility_aid": {
      const aid = info.fields[0]?.options?.find((o) => o.value === p.aidType);
      const size =
        p.widthCm && p.lengthCm ? `${p.widthCm} × ${p.lengthCm} cm` : "";
      return [aid?.label ?? info.label, size].filter(Boolean).join(" ");
    }
    case "transfer_area":
      return [
        info.label,
        p.widthCm && p.depthCm ? `${p.widthCm} × ${p.depthCm} cm` : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "reach_range":
      return [
        info.label,
        p.minCm != null && p.maxCm ? `${p.minCm}–${p.maxCm} cm` : "",
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return info.label;
  }
}

function needParams(need: LocalNeed): Record<string, unknown> {
  const info = needTypeInfo(need.needType);
  const out: Record<string, unknown> = {};
  for (const f of info.fields) {
    const raw = need.params[f.key];
    if (raw == null || raw === "") continue;
    if (f.kind === "cm") {
      const n = parseNumber(raw);
      if (n != null) out[f.key] = n;
    } else if (typeof raw === "string") {
      const s = raw.trim();
      if (s) out[f.key] = s.slice(0, 200);
    }
  }
  return out;
}

export type IdMaps = {
  rooms: Record<string, string>;
  persons: Record<string, string>;
};

// Map a local need onto the server input, resolving local room/person ids.
// Returns the validation message instead when it isn't complete yet.
export function needPayload(
  need: LocalNeed,
  ids: IdMaps,
): { ok: true; value: AccessibilityNeedInput } | { ok: false; error: string } {
  const roomId =
    need.scope === "room" && need.roomId
      ? (ids.rooms[need.roomId] ?? null)
      : null;
  const personId =
    need.scope === "person" && need.personId
      ? (ids.persons[need.personId] ?? null)
      : null;
  const candidate = {
    needType: need.needType,
    scope: need.scope,
    roomId,
    personId,
    params: needParams(need),
    confirmed: need.confirmed,
    notes: need.notes?.trim() ? need.notes.trim().slice(0, 500) : null,
  };
  const parsed = AccessibilityNeedInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "This need isn't complete",
    };
  }
  return { ok: true, value: parsed.data };
}

// Same check before sign-in, with placeholder server ids for known locals.
export function needProblem(
  need: LocalNeed,
  roomIds: string[],
  personIds: string[],
): string | null {
  const fake = "00000000-0000-4000-8000-000000000000";
  const ids: IdMaps = {
    rooms: Object.fromEntries(roomIds.map((id) => [id, fake])),
    persons: Object.fromEntries(personIds.map((id) => [id, fake])),
  };
  const r = needPayload(need, ids);
  if (r.ok) return null;
  if (need.scope === "room" && need.roomId && !roomIds.includes(need.roomId)) {
    return "That room was removed. Choose another room.";
  }
  if (
    need.scope === "person" &&
    need.personId &&
    !personIds.includes(need.personId)
  ) {
    return "That person was removed. Choose someone else.";
  }
  if (/expected number|required/i.test(r.error)) {
    return "Add the measurements marked as required.";
  }
  return r.error;
}

export function needChanged(
  server: {
    needType: string;
    scope: string;
    roomId: string | null;
    personId: string | null;
    params: unknown;
    confirmed: boolean;
    notes: string | null;
  },
  desired: AccessibilityNeedInput,
) {
  return (
    server.needType !== desired.needType ||
    server.scope !== desired.scope ||
    (server.roomId ?? null) !== (desired.roomId ?? null) ||
    (server.personId ?? null) !== (desired.personId ?? null) ||
    !sameJson(server.params, desired.params) ||
    server.confirmed !== (desired.confirmed ?? false) ||
    (server.notes ?? null) !== (desired.notes ?? null)
  );
}

// ---------------------------------------------------------------------------
// Possessions (FR-11)
// ---------------------------------------------------------------------------

export const POSSESSION_CATEGORIES = [
  "Sofa",
  "Armchair",
  "Bed",
  "Cot",
  "Wardrobe",
  "Chest of drawers",
  "Dining table",
  "Dining chairs",
  "Desk",
  "Bookcase",
  "Storage",
  "TV unit",
  "Coffee table",
  "Rug",
  "Other",
];

export function possessionPayload(
  item: LocalPossession,
  roomIds: Record<string, string>,
): Required<
  Pick<
    CreatePossession,
    | "name"
    | "category"
    | "widthCm"
    | "depthCm"
    | "heightCm"
    | "keep"
    | "notes"
    | "roomId"
  >
> {
  return {
    name: item.name.trim().slice(0, 120) || item.category || "Item",
    category: (item.category || "Other").slice(0, 60),
    widthCm: toCm(item.widthCm),
    depthCm: toCm(item.depthCm),
    heightCm: toCm(item.heightCm),
    keep: item.keep,
    notes: item.notes?.trim() ? item.notes.trim().slice(0, 500) : null,
    roomId: item.roomId ? (roomIds[item.roomId] ?? null) : null,
  };
}

export function possessionChanged(
  server: {
    name: string;
    category: string;
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
    keep: boolean;
    notes: string | null;
    roomId: string | null;
  },
  desired: ReturnType<typeof possessionPayload>,
) {
  return (
    server.name !== desired.name ||
    server.category !== desired.category ||
    (server.widthCm ?? null) !== desired.widthCm ||
    (server.depthCm ?? null) !== desired.depthCm ||
    (server.heightCm ?? null) !== desired.heightCm ||
    server.keep !== desired.keep ||
    (server.notes ?? null) !== desired.notes ||
    (server.roomId ?? null) !== desired.roomId
  );
}

export function possessionSize(item: {
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
}): string {
  const dims = [item.widthCm, item.depthCm, item.heightCm].filter(
    (d): d is number => d != null && d > 0,
  );
  if (!dims.length) return "Size not measured yet";
  return `${dims.join(" × ")} cm`;
}

// ---------------------------------------------------------------------------
// Rooms (FP-004 review, FP-006 manual rooms)
// ---------------------------------------------------------------------------

export function roomPayload(
  room: PlanRoom,
): Required<
  Pick<
    CreateRoom,
    "name" | "roomType" | "widthCm" | "lengthCm" | "dimensionStatus"
  >
> {
  const known = room.widthCm != null && room.lengthCm != null;
  return {
    name: room.name.trim().slice(0, 80) || "Room",
    roomType: room.roomType,
    widthCm: room.widthCm && room.widthCm > 0 ? room.widthCm : null,
    lengthCm: room.lengthCm && room.lengthCm > 0 ? room.lengthCm : null,
    dimensionStatus:
      room.widthCm == null && room.lengthCm == null
        ? "unknown"
        : known
          ? room.status
          : room.status === "user_confirmed"
            ? "estimated"
            : room.status,
  };
}

// Only the fields that differ, so unchanged dimensions never clear a review.
export function roomPatch(
  server: {
    name: string;
    roomType: string;
    widthCm: number | null;
    lengthCm: number | null;
    dimensionStatus: string;
  },
  desired: ReturnType<typeof roomPayload>,
): Partial<ReturnType<typeof roomPayload>> | null {
  const patch: Partial<ReturnType<typeof roomPayload>> = {};
  if (server.name !== desired.name) patch.name = desired.name;
  if (server.roomType !== desired.roomType) patch.roomType = desired.roomType;
  const dimsChanged =
    (server.widthCm ?? null) !== desired.widthCm ||
    (server.lengthCm ?? null) !== desired.lengthCm;
  if ((server.widthCm ?? null) !== desired.widthCm) {
    patch.widthCm = desired.widthCm;
  }
  if ((server.lengthCm ?? null) !== desired.lengthCm) {
    patch.lengthCm = desired.lengthCm;
  }
  if (dimsChanged || server.dimensionStatus !== desired.dimensionStatus) {
    patch.dimensionStatus = desired.dimensionStatus;
  }
  return Object.keys(patch).length ? patch : null;
}

// What the user confirmed when they pressed "Use these rooms".
export function roomFingerprint(room: PlanRoom): string {
  return [room.name, room.roomType, room.widthCm, room.lengthCm, room.status]
    .map((v) => String(v ?? ""))
    .join("|");
}

export function reviewedRoomMap(rooms: PlanRoom[]): Record<string, string> {
  return Object.fromEntries(rooms.map((r) => [r.id, roomFingerprint(r)]));
}

export function isRoomConfirmed(
  room: PlanRoom,
  reviewed: Record<string, string> | undefined,
): boolean {
  return reviewed?.[room.id] === roomFingerprint(room);
}

// ---------------------------------------------------------------------------
// Listing preview → journey answers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resume (MB-005)
// ---------------------------------------------------------------------------

const BOOKKEEPING = new Set<keyof JourneyData>([
  "lastStep",
  "homeId",
  "ownerUserId",
  "serverIds",
  "updatedAt",
  "reviewedRooms",
]);

export function hasAnswers(data: JourneyData): boolean {
  return Object.entries(data).some(([k, v]) => {
    if (BOOKKEEPING.has(k as keyof JourneyData)) return false;
    if (v == null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  });
}

// Fingerprint of what the user has entered (not sync bookkeeping), used to
// decide whether an automatic save is needed.
export function contentKey(
  data: JourneyData,
  rooms: PlanRoom[] | null,
): string {
  const {
    serverIds: _ids,
    homeId: _home,
    ownerUserId: _owner,
    updatedAt: _at,
    ...answers
  } = data;
  return stableJson({ answers, rooms });
}

export function buildDraft(
  data: JourneyData,
  rooms: PlanRoom[] | null,
): JourneyDraft {
  const { ownerUserId: _owner, ...answers } = data;
  return { version: 1, answers, rooms };
}

export function readDraft(
  value: unknown,
): { answers: JourneyData; rooms: PlanRoom[] | null } | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Partial<JourneyDraft>;
  if (d.version !== 1 || !d.answers || typeof d.answers !== "object") {
    return null;
  }
  return {
    answers: d.answers,
    rooms: Array.isArray(d.rooms) ? d.rooms : null,
  };
}
