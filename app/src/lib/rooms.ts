import type { MeasurementStatus, RoomType } from "@stepchange/shared";

export type PropertyType = "house" | "flat" | "bungalow" | "maisonette";

export type HomeBasics = {
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
};

export type PlanRoom = {
  id: string;
  name: string;
  roomType: RoomType;
  widthCm: number | null;
  lengthCm: number | null;
  status: MeasurementStatus;
  source: "template" | "floor_plan" | "manual";
  // Once the user touches a room we never remove it automatically.
  edited: boolean;
  note?: string;
};

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  living_room: "Living room",
  kitchen: "Kitchen",
  kitchen_diner: "Kitchen / diner",
  dining_room: "Dining room",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  en_suite: "En suite",
  wc: "WC",
  study: "Study",
  playroom: "Playroom",
  hallway: "Hallway",
  landing: "Landing",
  utility: "Utility",
  conservatory: "Conservatory",
  garage: "Garage",
  other: "Other",
};

export const STATUS_LABELS: Record<MeasurementStatus, string> = {
  user_confirmed: "Confirmed by you",
  source_printed: "From the floor plan",
  calculated: "Calculated from scale",
  estimated: "Estimated · needs measurement",
  unknown: "Size unknown · needs measurement",
};

const BEDROOM_TYPES: RoomType[] = ["bedroom"];
const BATHROOM_TYPES: RoomType[] = ["bathroom", "en_suite"];
const MULTI_STOREY: PropertyType[] = ["house", "maisonette"];

let counter = 0;
export function roomId(): string {
  counter += 1;
  return `room-${Date.now().toString(36)}-${counter}`;
}

function blank(
  name: string,
  roomType: RoomType,
  source: PlanRoom["source"] = "template",
): PlanRoom {
  return {
    id: roomId(),
    name,
    roomType,
    widthCm: null,
    lengthCm: null,
    status: "unknown",
    source,
    edited: false,
  };
}

export function clampCount(value: unknown, fallback: number, max = 12): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

function bedroomName(n: number, total: number) {
  return n === 1 && total > 1 ? "Main bedroom" : `Bedroom ${n}`;
}

function bathroomName(n: number, total: number) {
  return total === 1 ? "Bathroom" : `Bathroom ${n}`;
}

// Starting room list for a home before any floor plan is available. Sizes are
// left unknown: we never invent dimensions.
export function templateRooms(basics: HomeBasics): PlanRoom[] {
  const rooms: PlanRoom[] = [
    blank("Living room", "living_room"),
    blank("Kitchen / diner", "kitchen_diner"),
    blank("Hallway", "hallway"),
  ];
  if (MULTI_STOREY.includes(basics.propertyType)) {
    rooms.push(blank("Landing", "landing"));
  }
  for (let i = 1; i <= basics.bedrooms; i++) {
    rooms.push(blank(bedroomName(i, basics.bedrooms), "bedroom"));
  }
  for (let i = 1; i <= basics.bathrooms; i++) {
    rooms.push(blank(bathroomName(i, basics.bathrooms), "bathroom"));
  }
  return rooms;
}

function nextFreeName(rooms: PlanRoom[], base: string, start: number) {
  const names = new Set(rooms.map((r) => r.name.toLowerCase()));
  let n = start;
  while (names.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function reconcileKind(
  rooms: PlanRoom[],
  types: RoomType[],
  target: number,
  base: "Bedroom" | "Bathroom",
  addNote?: string,
): { rooms: PlanRoom[]; surplus: number } {
  let out = [...rooms];
  const matching = () => out.filter((r) => types.includes(r.roomType));

  while (matching().length < target) {
    const count = matching().length;
    const room = blank(
      nextFreeName(out, base, count + 1),
      types[0] as RoomType,
      "template",
    );
    if (addNote) room.note = addNote;
    out.push(room);
  }

  // Only untouched template rooms are removed; the user's own rooms and rooms
  // found on a floor plan are kept and reported instead.
  let surplus = matching().length - target;
  for (let i = out.length - 1; i >= 0 && surplus > 0; i--) {
    const r = out[i] as PlanRoom;
    if (types.includes(r.roomType) && r.source === "template" && !r.edited) {
      out = out.filter((x) => x.id !== r.id);
      surplus--;
    }
  }
  return { rooms: out, surplus };
}

export type ReconcileResult = { rooms: PlanRoom[]; warnings: string[] };

// Make the room list agree with the declared number of bedrooms/bathrooms.
export function reconcileRooms(
  rooms: PlanRoom[],
  basics: HomeBasics,
  opts: { addNote?: string } = {},
): ReconcileResult {
  const warnings: string[] = [];
  const beds = reconcileKind(
    rooms,
    BEDROOM_TYPES,
    basics.bedrooms,
    "Bedroom",
    opts.addNote,
  );
  if (beds.surplus > 0) {
    warnings.push(
      `You said ${basics.bedrooms} bedroom${basics.bedrooms === 1 ? "" : "s"}, but ${basics.bedrooms + beds.surplus} are listed. Remove or retype any that aren't bedrooms.`,
    );
  }
  const baths = reconcileKind(
    beds.rooms,
    BATHROOM_TYPES,
    basics.bathrooms,
    "Bathroom",
    opts.addNote,
  );
  if (baths.surplus > 0) {
    warnings.push(
      `You said ${basics.bathrooms} bathroom${basics.bathrooms === 1 ? "" : "s"}, but ${basics.bathrooms + baths.surplus} are listed.`,
    );
  }
  return { rooms: baths.rooms, warnings };
}

export function countOf(rooms: PlanRoom[], kind: "bedroom" | "bathroom") {
  const types = kind === "bedroom" ? BEDROOM_TYPES : BATHROOM_TYPES;
  return rooms.filter((r) => types.includes(r.roomType)).length;
}

const KNOWN_TYPES = new Set(Object.keys(ROOM_TYPE_LABELS));

export type ExtractedPlanRoom = {
  name: string;
  roomType: string;
  widthCm: number | null;
  lengthCm: number | null;
  dimensionStatus: MeasurementStatus;
};

// Replace the room list with what the floor plan shows, then top up any
// bedrooms/bathrooms the user declared but the plan didn't show.
export function roomsFromFloorPlan(
  extracted: ExtractedPlanRoom[],
  basics: HomeBasics,
): ReconcileResult {
  const rooms: PlanRoom[] = extracted.map((r) => ({
    id: roomId(),
    name: r.name,
    roomType: (KNOWN_TYPES.has(r.roomType) ? r.roomType : "other") as RoomType,
    widthCm: r.widthCm,
    lengthCm: r.lengthCm,
    status:
      r.widthCm == null || r.lengthCm == null ? "unknown" : r.dimensionStatus,
    source: "floor_plan",
    edited: false,
  }));
  return reconcileRooms(rooms, basics, {
    addNote: "Not found on the floor plan · add its measurements",
  });
}

// "4.6", "4.6 m", "460cm", "460 cm" → centimetres.
export function parseLength(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|cm|mm)?$/);
  if (!m) return null;
  const value = Number.parseFloat(m[1] as string);
  const unit = m[2] ?? (value > 20 ? "cm" : "m");
  const cm = unit === "m" ? value * 100 : unit === "mm" ? value / 10 : value;
  return cm > 0 && cm <= 5000 ? Math.round(cm) : null;
}

export function formatMetres(cm: number | null): string {
  return cm == null ? "" : `${(cm / 100).toFixed(1)}`;
}

export function formatDims(room: PlanRoom): string {
  if (room.widthCm == null || room.lengthCm == null) return "Size unknown";
  return `${formatMetres(room.widthCm)} × ${formatMetres(room.lengthCm)} m`;
}
