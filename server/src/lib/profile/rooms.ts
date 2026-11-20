import type {
  CreateFeature,
  CreateRoom,
  MeasurementKind,
  MeasurementStatus,
  UpdateFeature,
  UpdateRoom,
} from "@stepchange/shared";

// Pure planning for room / feature writes: which columns change, which
// measurement rows to record (FP-003 provenance) and whether the user's
// review must be cleared (FP-004).

export type MeasurementInsert = {
  roomId: string;
  kind: MeasurementKind;
  valueCm: number | null;
  status: MeasurementStatus;
  source: string;
  sourceUploadId: string | null;
  confidence: number | null;
};

type Dims = {
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
};

const DIM_KINDS: Array<[keyof Dims, MeasurementKind]> = [
  ["widthCm", "width"],
  ["lengthCm", "length"],
  ["heightCm", "height"],
];

// Strongest first.
const STATUS_RANK: Record<MeasurementStatus, number> = {
  user_confirmed: 4,
  source_printed: 3,
  calculated: 2,
  estimated: 1,
  unknown: 0,
};

export const weakerStatus = (
  a: MeasurementStatus,
  b: MeasurementStatus,
): MeasurementStatus => (STATUS_RANK[a] <= STATUS_RANK[b] ? a : b);

const hasAny = (o: Partial<Record<string, number | null | undefined>>) =>
  Object.values(o).some((v) => typeof v === "number");

export type RoomInsertPlan = {
  values: {
    name: string;
    roomType: string;
    floorId: string | null;
    selected: boolean;
    widthCm: number | null;
    lengthCm: number | null;
    heightCm: number | null;
    dimensionStatus: MeasurementStatus;
    polygon: Array<{ x: number; y: number }> | null;
  };
  measurements: MeasurementInsert[];
};

export function planRoomCreate(
  roomId: string,
  input: CreateRoom,
): RoomInsertPlan {
  const dims: Dims = {
    widthCm: input.widthCm ?? null,
    lengthCm: input.lengthCm ?? null,
    heightCm: input.heightCm ?? null,
  };
  const dimensionStatus: MeasurementStatus =
    input.dimensionStatus ?? (hasAny(dims) ? "user_confirmed" : "unknown");
  const measurements: MeasurementInsert[] = [];
  for (const [key, kind] of DIM_KINDS) {
    const valueCm = dims[key];
    if (valueCm === null) continue;
    measurements.push({
      roomId,
      kind,
      valueCm,
      status: dimensionStatus,
      source: input.dimensionSource ?? "user",
      sourceUploadId: input.sourceUploadId ?? null,
      confidence: input.confidence ?? null,
    });
  }
  return {
    values: {
      name: input.name,
      roomType: input.roomType ?? "other",
      floorId: input.floorId ?? null,
      selected: input.selected ?? true,
      ...dims,
      dimensionStatus,
      polygon: input.polygon ?? null,
    },
    measurements,
  };
}

export type RoomUpdatePlan = {
  set: Partial<RoomInsertPlan["values"]> & { reviewedAt?: null };
  measurements: MeasurementInsert[];
  invalidatesReview: boolean;
};

export function planRoomUpdate(
  current: Dims & {
    id: string;
    dimensionStatus: MeasurementStatus;
  },
  patch: UpdateRoom,
): RoomUpdatePlan {
  const set: RoomUpdatePlan["set"] = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.roomType !== undefined) set.roomType = patch.roomType;
  if (patch.floorId !== undefined) set.floorId = patch.floorId;
  if (patch.selected !== undefined) set.selected = patch.selected;

  const changedKinds = DIM_KINDS.filter(
    ([key]) => patch[key] !== undefined && patch[key] !== current[key],
  );
  const statusChanged =
    patch.dimensionStatus !== undefined &&
    patch.dimensionStatus !== current.dimensionStatus;
  const polygonChanged = patch.polygon !== undefined;

  const next: Dims = {
    widthCm: patch.widthCm !== undefined ? patch.widthCm : current.widthCm,
    lengthCm: patch.lengthCm !== undefined ? patch.lengthCm : current.lengthCm,
    heightCm: patch.heightCm !== undefined ? patch.heightCm : current.heightCm,
  };

  const measurements: MeasurementInsert[] = [];
  if (changedKinds.length > 0 || statusChanged) {
    // User-entered dimensions are user-confirmed unless stated otherwise.
    const status: MeasurementStatus =
      patch.dimensionStatus ??
      (changedKinds.length > 0 ? "user_confirmed" : current.dimensionStatus);
    set.dimensionStatus = patch.dimensionStatus ?? status;
    if (patch.dimensionStatus === undefined) {
      // The room-level status must not overclaim: an untouched plan
      // dimension keeps its weaker provenance.
      const untouchedPlanDim = (["widthCm", "lengthCm"] as const).some(
        (k) => patch[k] === undefined && next[k] !== null,
      );
      if (untouchedPlanDim) {
        set.dimensionStatus = weakerStatus(status, current.dimensionStatus);
      }
      if (!hasAny(next)) set.dimensionStatus = "unknown";
    }
    for (const [key] of changedKinds) set[key] = next[key];

    // A status-only change re-records every known dimension under the new
    // status; otherwise only the dimensions that changed are recorded.
    const kinds =
      changedKinds.length > 0
        ? changedKinds
        : DIM_KINDS.filter(([key]) => next[key] !== null);
    for (const [key, kind] of kinds) {
      const valueCm = next[key];
      measurements.push({
        roomId: current.id,
        kind,
        valueCm,
        status: valueCm === null ? "unknown" : status,
        source: patch.dimensionSource ?? "user",
        sourceUploadId: patch.sourceUploadId ?? null,
        confidence: patch.confidence ?? null,
      });
    }
  }
  if (polygonChanged) set.polygon = patch.polygon ?? null;

  const invalidatesReview =
    changedKinds.length > 0 || statusChanged || polygonChanged;
  if (invalidatesReview) set.reviewedAt = null;
  return { set, measurements, invalidatesReview };
}

export function featureInsertValues(roomId: string, input: CreateFeature) {
  const dims = {
    offsetCm: input.offsetCm ?? null,
    widthCm: input.widthCm ?? null,
    heightCm: input.heightCm ?? null,
  };
  return {
    roomId,
    type: input.type,
    wall: input.wall ?? null,
    ...dims,
    status:
      input.status ??
      (hasAny({ widthCm: dims.widthCm, heightCm: dims.heightCm })
        ? "user_confirmed"
        : "unknown"),
    notes: input.notes ?? null,
  } as const;
}

// When dimensions change without an explicit status, they are user-entered.
export function featureUpdateValues(
  current: {
    widthCm: number | null;
    heightCm: number | null;
    offsetCm: number | null;
  },
  patch: UpdateFeature,
): UpdateFeature {
  const set: UpdateFeature = { ...patch };
  const dimsChanged = (["widthCm", "heightCm", "offsetCm"] as const).some(
    (k) => patch[k] !== undefined && patch[k] !== current[k],
  );
  if (dimsChanged && patch.status === undefined) {
    const width = patch.widthCm !== undefined ? patch.widthCm : current.widthCm;
    const height =
      patch.heightCm !== undefined ? patch.heightCm : current.heightCm;
    set.status =
      width !== null || height !== null ? "user_confirmed" : "unknown";
  }
  return set;
}
