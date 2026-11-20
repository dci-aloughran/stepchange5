import type {
  DimensionState,
  HomeOverview,
  MeasurementStatus,
  OverviewRoom,
  OverviewWarning,
} from "@stepchange/shared";
import {
  type FeatureRow,
  type FloorRow,
  type HomeRow,
  type RoomRow,
  toHome,
} from "./dto.js";

const KNOWN: MeasurementStatus[] = [
  "user_confirmed",
  "source_printed",
  "calculated",
];

// Features whose width matters for clearances and access.
const SIZED_FEATURES = new Set(["door", "window", "bay_window", "stairs"]);

const FEATURE_LABEL: Record<string, string> = {
  door: "door",
  window: "window",
  bay_window: "bay window",
  stairs: "staircase",
};

export function dimensionState(room: {
  widthCm: number | null;
  lengthCm: number | null;
  dimensionStatus: MeasurementStatus;
}): DimensionState {
  if (room.widthCm === null || room.lengthCm === null) return "unknown";
  if (KNOWN.includes(room.dimensionStatus)) return "known";
  if (room.dimensionStatus === "estimated") return "estimated";
  return "unknown";
}

export function areaSqm(widthCm: number | null, lengthCm: number | null) {
  if (widthCm === null || lengthCm === null) return null;
  return Math.round((widthCm * lengthCm) / 1000) / 10;
}

// "Home overview": dimension status per room, review state and AC-005 /
// FP-005 warnings that ask for a measurement instead of claiming fit.
export function buildHomeOverview(
  home: HomeRow,
  floors: FloorRow[],
  rooms: RoomRow[],
  features: FeatureRow[],
): HomeOverview {
  const featuresByRoom = new Map<string, FeatureRow[]>();
  for (const f of features) {
    const list = featuresByRoom.get(f.roomId) ?? [];
    list.push(f);
    featuresByRoom.set(f.roomId, list);
  }

  const levelByFloor = new Map(floors.map((f) => [f.id, f.level]));
  const sortedRooms = [...rooms].sort(
    (a, b) =>
      (levelByFloor.get(a.floorId ?? "") ?? 0) -
        (levelByFloor.get(b.floorId ?? "") ?? 0) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const warnings: OverviewWarning[] = [];
  const overviewRooms: OverviewRoom[] = sortedRooms.map((r) => {
    const state = dimensionState(r);
    const roomFeatures = featuresByRoom.get(r.id) ?? [];
    const reviewed = r.reviewedAt !== null;

    if (r.selected) {
      if (state === "unknown") {
        warnings.push({
          code: "dimensions_unknown",
          severity: "warning",
          roomId: r.id,
          action: "measure_room",
          message: `We don't know the size of ${r.name} yet. Measure its width and length so we can check what fits. Until then we can't confirm fit or accessibility.`,
        });
      } else if (state === "estimated") {
        warnings.push({
          code: "dimensions_estimated",
          severity: "warning",
          roomId: r.id,
          action: "measure_room",
          message: `The size of ${r.name} is an estimate. Measure it to confirm before we check fit or accessibility.`,
        });
      }
      for (const f of roomFeatures) {
        if (!SIZED_FEATURES.has(f.type)) continue;
        if (f.widthCm !== null && f.status !== "unknown") continue;
        warnings.push({
          code: "feature_dimensions_unknown",
          severity: "info",
          roomId: r.id,
          action: "measure_feature",
          message: `A ${FEATURE_LABEL[f.type] ?? f.type} in ${r.name} has no confirmed width. Measure it so we can check clearances.`,
        });
      }
      if (!reviewed) {
        warnings.push({
          code: "room_not_reviewed",
          severity: "info",
          roomId: r.id,
          action: "review_room",
          message: `Check the details for ${r.name} and confirm them before we plan layouts.`,
        });
      }
    }

    return {
      id: r.id,
      floorId: r.floorId,
      name: r.name,
      roomType: r.roomType,
      selected: r.selected,
      widthCm: r.widthCm,
      lengthCm: r.lengthCm,
      heightCm: r.heightCm,
      areaSqm: areaSqm(r.widthCm, r.lengthCm),
      dimensionStatus: r.dimensionStatus,
      dimensionState: state,
      featureCount: roomFeatures.length,
      reviewed,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      readyForLayouts: reviewed && state === "known",
    };
  });

  const selected = overviewRooms.filter((r) => r.selected);
  if (rooms.length === 0) {
    warnings.unshift({
      code: "no_rooms",
      severity: "warning",
      roomId: null,
      action: "add_rooms",
      message:
        "This home has no rooms yet. Upload a floor plan or add rooms yourself.",
    });
  } else if (selected.length === 0) {
    warnings.unshift({
      code: "no_rooms_selected",
      severity: "warning",
      roomId: null,
      action: "select_rooms",
      message: "Choose at least one room you'd like to plan.",
    });
  }

  const h = toHome(home);
  return {
    home: {
      id: h.id,
      name: h.name,
      journeyType: h.journeyType,
      retentionState: h.retentionState,
      retainUntil: h.retainUntil,
    },
    floors: [...floors]
      .sort((a, b) => a.level - b.level)
      .map((f) => ({ id: f.id, name: f.name, level: f.level })),
    rooms: overviewRooms,
    summary: {
      totalRooms: overviewRooms.length,
      selectedRooms: selected.length,
      reviewedRooms: overviewRooms.filter((r) => r.reviewed).length,
      roomsNeedingMeasurement: selected.filter(
        (r) => r.dimensionState !== "known",
      ).length,
      roomsReadyForLayouts: overviewRooms.filter((r) => r.readyForLayouts)
        .length,
      readyForLayouts:
        selected.length > 0 && selected.every((r) => r.readyForLayouts),
    },
    warnings,
  };
}
