// Room / budget status derivation for the plan overview (pure).

import type {
  Brief,
  HomeBudgetResponse,
  HomeListItem,
  Layout,
  OverviewRoom,
} from "@stepchange/shared";

export type RoomPlanStatus =
  | "needs_measurement"
  | "needs_review"
  | "ready_for_brief"
  | "brief_draft"
  | "brief_ready"
  | "layout_needs_attention"
  | "layout_verified"
  | "products_chosen";

export const ROOM_STATUS_LABELS: Record<RoomPlanStatus, string> = {
  needs_measurement: "Needs measurement",
  needs_review: "Needs a quick review",
  ready_for_brief: "Ready for a brief",
  brief_draft: "Brief to review",
  brief_ready: "Brief ready",
  layout_needs_attention: "Layout needs attention",
  layout_verified: "Layout verified",
  products_chosen: "Products chosen",
};

// Index into the plan steps: 0 brief, 1 layout, 2 concept/shop, 3 done.
export const ROOM_STATUS_PROGRESS: Record<RoomPlanStatus, number> = {
  needs_measurement: 0,
  needs_review: 0,
  ready_for_brief: 0,
  brief_draft: 0,
  brief_ready: 1,
  layout_needs_attention: 1,
  layout_verified: 2,
  products_chosen: 3,
};

export type RoomStatusInput = {
  room: Pick<OverviewRoom, "dimensionState" | "reviewed">;
  // Latest brief (any status) or null.
  brief: Pick<Brief, "status"> | null;
  layout: { validation: Layout["validation"] } | null;
  // Number of requirements with a chosen live product.
  productCount: number;
};

export function isBriefUsable(brief: Pick<Brief, "status"> | null): boolean {
  return brief?.status === "accepted" || brief?.status === "edited";
}

export function deriveRoomStatus(input: RoomStatusInput): RoomPlanStatus {
  const { room, brief, layout, productCount } = input;
  if (productCount > 0 && isBriefUsable(brief)) return "products_chosen";
  if (layout && isBriefUsable(brief)) {
    const v = layout.validation;
    return v?.verifiedFit && v.verifiedAccessible
      ? "layout_verified"
      : "layout_needs_attention";
  }
  if (isBriefUsable(brief)) return "brief_ready";
  if (brief?.status === "draft") return "brief_draft";
  if (room.dimensionState !== "known") return "needs_measurement";
  if (!room.reviewed) return "needs_review";
  return "ready_for_brief";
}

// Requirements in a budget room with a counted live product price.
export function productCountForRoom(
  budget: HomeBudgetResponse | null,
  roomId: string,
): number {
  const room = budget?.rooms.find((r) => r.roomId === roomId);
  return room?.lines.filter((l) => l.recommendationId != null).length ?? 0;
}

export type BudgetStatus = HomeBudgetResponse["status"];

export const BUDGET_STATUS_TEXT: Record<
  BudgetStatus,
  { label: string; tone: "ok" | "warn" | "bad" | "none" }
> = {
  within: { label: "Within budget", tone: "ok" },
  at_risk: { label: "At risk of going over", tone: "warn" },
  over: { label: "Over budget", tone: "bad" },
  no_budget: { label: "No budget set", tone: "none" },
};

// Status of an arbitrary range against a budget (same rules as the server).
export function budgetStatus(
  lowPence: number,
  highPence: number,
  budgetPence: number | null,
): BudgetStatus {
  if (budgetPence == null) return "no_budget";
  if (lowPence > budgetPence) return "over";
  if (highPence > budgetPence) return "at_risk";
  return "within";
}

// Share of the budget used by the upper end of a range, 0..1+ (for meters).
export function budgetShare(
  highPence: number,
  budgetPence: number | null,
): number | null {
  if (!budgetPence || budgetPence <= 0) return null;
  return highPence / budgetPence;
}

const PRIORITY_ORDER = { must: 0, should: 1, could: 2 } as const;
export type Priority = keyof typeof PRIORITY_ORDER;

export type ShoppingItem = {
  roomId: string;
  roomName: string;
  requirementId: string;
  description: string;
  category: string;
  quantity: number;
  priority: Priority;
  source: "product" | "estimate" | "retained" | "unpriced";
  productTitle: string | null;
  retailer: string | null;
  lowPence: number;
  highPence: number;
  excludedReason: string | null;
};

// Prioritised shopping list across rooms: must → should → could, then
// live-priced before estimates, then room order. Retained items are dropped.
export function buildShoppingList(
  budget: HomeBudgetResponse,
  priorities: Map<string, Priority>,
): ShoppingItem[] {
  const items: Array<ShoppingItem & { roomIndex: number; lineIndex: number }> =
    [];
  budget.rooms.forEach((room, roomIndex) => {
    room.lines.forEach((l, lineIndex) => {
      if (l.source === "retained") return;
      items.push({
        roomId: room.roomId,
        roomName: room.name,
        requirementId: l.requirementId,
        description: l.description,
        category: l.category,
        quantity: l.quantity,
        priority:
          priorities.get(`${room.roomId}:${l.requirementId}`) ?? "should",
        source: l.source,
        productTitle: l.productTitle,
        retailer: l.retailer,
        lowPence: l.lowPence,
        highPence: l.highPence,
        excludedReason: l.excludedReason,
        roomIndex,
        lineIndex,
      });
    });
  });
  const sourceRank = { product: 0, estimate: 1, unpriced: 2, retained: 3 };
  items.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      sourceRank[a.source] - sourceRank[b.source] ||
      a.roomIndex - b.roomIndex ||
      a.lineIndex - b.lineIndex,
  );
  return items.map(({ roomIndex: _r, lineIndex: _l, ...rest }) => rest);
}

// Running total of a prioritised list: index of the first item whose upper
// cumulative total exceeds the budget (null if all fit or no budget).
export function firstOverBudgetIndex(
  items: Pick<ShoppingItem, "highPence">[],
  budgetPence: number | null,
): number | null {
  if (budgetPence == null) return null;
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i]?.highPence ?? 0;
    if (sum > budgetPence) return i;
  }
  return null;
}

// Measurement-related uncertainties are surfaced prominently (AC-005).
export function isMeasurementRequest(text: string): boolean {
  return /\b(measure|measurement|dimension|unknown|estimated|not verified|confirm)/i.test(
    text,
  );
}

// Pick the home the journey saved to the profile; fall back to the most
// recently updated home (GET /homes is ordered by updatedAt desc).
export function pickHomeId(
  profileHomeId: unknown,
  homes: Pick<HomeListItem, "id">[],
): string | null {
  if (
    typeof profileHomeId === "string" &&
    homes.some((h) => h.id === profileHomeId)
  ) {
    return profileHomeId;
  }
  return homes[0]?.id ?? null;
}
