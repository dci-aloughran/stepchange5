import type {
  AccessibilityNeedType,
  Frequency,
  PersonRole,
} from "@stepchange/shared";
import type { PlanRoom } from "../rooms";

// Local (device) journey answers. Everything is optional: the journey works
// signed out and is synced to the server once the user signs in (MB-005).

export type LocalPerson = {
  id: string;
  role: PersonRole;
  // Whole years. A baby on the way is stored as age 0 + onTheWay.
  ageYears: number | null;
  onTheWay?: boolean;
  // Optional, e.g. "Mum". Real names aren't needed (SE-007).
  label?: string;
  worksFromHome?: boolean;
};

export type NeedParamValue = string | number | boolean;

export type LocalNeed = {
  id: string;
  needType: AccessibilityNeedType;
  scope: "home" | "room" | "person";
  roomId?: string | null; // local room id
  personId?: string | null; // local person id
  params: Record<string, NeedParamValue | undefined>;
  // AC-003: only confirmed needs become hard layout rules.
  confirmed: boolean;
  notes?: string;
};

export type LocalPossession = {
  id: string;
  name: string;
  category: string;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  roomId: string | null; // local room id
  keep: boolean;
  notes?: string;
};

export type LocalLifestyle = {
  wfhDaysPerWeek?: number;
  entertaining?: Frequency;
  eatingTogether?: Frequency;
  tvGaming?: Frequency;
  cooking?: Frequency;
  hobbies?: string[];
  childrensPlay?: boolean;
  homework?: boolean;
  notes?: string;
};

export type LocalPractical = {
  storageLevel?: "minimal" | "average" | "lots";
  childSafety?: boolean;
  petFriendlyMaterials?: boolean;
  notes?: string;
};

// Local id → server id for each synced collection.
export type ServerIds = {
  rooms?: Record<string, string>;
  persons?: Record<string, string>;
  needs?: Record<string, string>;
  possessions?: Record<string, string>;
};

export type JourneyData = {
  // Home step (strings as typed by the user).
  journey?: string;
  propertyType?: string;
  listingUrl?: string;
  address?: string;
  beds?: string;
  baths?: string;
  area?: string;
  price?: string;
  listingDescription?: string;
  listingPhotoUploadIds?: string[];
  listingFloorPlanUploadId?: string | null;

  // Needs step.
  people?: LocalPerson[];
  lifestyle?: LocalLifestyle;
  practical?: LocalPractical;

  // Accessibility step.
  needs?: LocalNeed[];

  // Keep step.
  possessions?: LocalPossession[];
  find?: string;

  // Budget step.
  budget?: string; // whole pounds as typed, e.g. "6,000"
  priorities?: string[];
  timing?: string;

  // Rooms the user confirmed with "Use these rooms": local id → fingerprint
  // of the dimensions they confirmed (FP-004).
  reviewedRooms?: Record<string, string>;

  // Progress + sync bookkeeping.
  lastStep?: string;
  homeId?: string;
  ownerUserId?: string;
  serverIds?: ServerIds;
  updatedAt?: number;
};

export type JourneyKey = keyof JourneyData;

// What is saved to the server profile's journeyState.draft so another device
// can resume (MB-005).
export type JourneyDraft = {
  version: 1;
  answers: JourneyData;
  rooms: PlanRoom[] | null;
};
