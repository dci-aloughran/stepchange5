import {
  BUYER_RETENTION_DAYS,
  type JourneyType,
  NOT_PROCEEDING_RETENTION_DAYS,
  type RetentionState,
} from "@stepchange/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (now: Date, days: number) =>
  new Date(now.getTime() + days * DAY_MS);

export type RetentionFields = {
  journeyType: JourneyType;
  retentionState: RetentionState;
  retainUntil: Date | null;
};

// SE-011: buyer homes get a distinct retention state and an expiry.
export function initialRetention(
  journeyType: JourneyType,
  now: Date,
): RetentionFields {
  return journeyType === "buyer"
    ? {
        journeyType,
        retentionState: "buyer_active",
        retainUntil: addDays(now, BUYER_RETENTION_DAYS),
      }
    : { journeyType, retentionState: "active", retainUntil: null };
}

// Resolves journeyType/retention after a PATCH. Returns null when nothing
// retention-related changed.
//  - retentionState "purchase_not_proceeding" -> keep 30 days from now.
//  - retentionState "buyer_active" -> buyer journey, 180 days from now.
//  - retentionState "active" -> purchase completed; becomes a homeowner home.
//  - journeyType change alone -> initial retention for the new journey.
export function resolveRetention(
  current: RetentionFields,
  patch: { journeyType?: JourneyType; retentionState?: RetentionState },
  now: Date,
): RetentionFields | null {
  const { journeyType, retentionState } = patch;
  if (retentionState && retentionState !== current.retentionState) {
    switch (retentionState) {
      case "purchase_not_proceeding":
        return {
          journeyType: "buyer",
          retentionState,
          retainUntil: addDays(now, NOT_PROCEEDING_RETENTION_DAYS),
        };
      case "buyer_active":
        return initialRetention("buyer", now);
      case "active":
        return initialRetention("homeowner", now);
    }
  }
  if (journeyType && journeyType !== current.journeyType) {
    return initialRetention(journeyType, now);
  }
  return null;
}
