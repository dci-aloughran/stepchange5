import type {
  AccessibilityNeedType,
  MeasurementStatus,
} from "@stepchange/shared";

export type FeatureType =
  | "door"
  | "window"
  | "bay_window"
  | "fireplace"
  | "radiator"
  | "stairs"
  | "column"
  | "built_in"
  | "other";

export type WallSide = "north" | "east" | "south" | "west";

export type Priority = "must" | "should" | "could";

export type RoomGeometry = {
  widthCm: number | null;
  lengthCm: number | null;
  heightCm?: number | null;
  dimensionStatus: MeasurementStatus;
};

export type FeatureInput = {
  id?: string;
  type: FeatureType;
  wall: WallSide | null;
  offsetCm: number | null;
  widthCm: number | null;
  status: MeasurementStatus;
};

export type NeedInput = {
  id?: string;
  needType: AccessibilityNeedType;
  params: Record<string, unknown>;
  confirmed: boolean;
};

export type LayoutItem = {
  requirementId: string;
  label: string;
  category: string;
  priority: Priority;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg: number;
  heightCm: number | null;
  // False when the footprint is a typical size rather than a requirement
  // bound or a measured possession.
  dimsKnown: boolean;
};

// Dimension statuses that may support a verified-fit claim (FP-003, D-005).
export const VERIFIED_DIMENSION_STATUSES: ReadonlySet<MeasurementStatus> =
  new Set(["user_confirmed", "source_printed", "calculated"]);

export function hasVerifiedDims(room: RoomGeometry): boolean {
  return (
    room.widthCm != null &&
    room.lengthCm != null &&
    room.widthCm > 0 &&
    room.lengthCm > 0 &&
    VERIFIED_DIMENSION_STATUSES.has(room.dimensionStatus)
  );
}

export function describeStatus(status: MeasurementStatus): string {
  switch (status) {
    case "user_confirmed":
      return "user-confirmed";
    case "source_printed":
      return "printed on the floor plan";
    case "calculated":
      return "calculated from a verified scale";
    case "estimated":
      return "estimated";
    default:
      return "unknown";
  }
}
