import { z } from "zod";
import {
  AccessibilityNeedTypeSchema,
  AccessibilityScopeSchema,
  JourneyTypeSchema,
  PersonRoleSchema,
} from "./enums.js";

// Profile area: user, household, persons, accessibility needs, existing
// possessions, data export. Money is integer pence; lengths are cm.

const cm = z.number().positive().max(10_000);
const isoDate = z.string();

// ---------------------------------------------------------------------------
// User (MB-005 resume state, SE-010 consent)
// ---------------------------------------------------------------------------

const JOURNEY_STATE_MAX_BYTES = 64_000;

// MB-005: the app stores the last confirmed step plus draft data. Free-form
// beyond the two well-known keys, capped in size.
export const JourneyStateSchema = z
  .object({
    lastConfirmedStep: z.string().max(100).optional(),
    draft: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());
export type JourneyState = z.infer<typeof JourneyStateSchema>;

export const UserProfileSchema = z.object({
  id: z.string(),
  journeyType: JourneyTypeSchema.nullable(),
  journeyState: JourneyStateSchema,
  aiTrainingConsent: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

// PATCH /profile/me. journeyState is shallow-merged into the stored state;
// a key set to null is removed.
export const UpdateUserProfileSchema = z
  .object({
    journeyType: JourneyTypeSchema.nullable().optional(),
    journeyState: z
      .record(z.string().max(100), z.unknown())
      .refine(
        (v) => JSON.stringify(v).length <= JOURNEY_STATE_MAX_BYTES,
        "Saved progress is too large",
      )
      .optional(),
    // SE-010: separate, revocable consent; default off.
    aiTrainingConsent: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateUserProfile = z.infer<typeof UpdateUserProfileSchema>;

// ---------------------------------------------------------------------------
// Household (FR-01, FR-02)
// ---------------------------------------------------------------------------

export const FrequencySchema = z.enum([
  "never",
  "occasionally",
  "regularly",
  "daily",
]);
export type Frequency = z.infer<typeof FrequencySchema>;

export const LifestyleSchema = z.object({
  wfhDaysPerWeek: z.number().int().min(0).max(7).optional(),
  entertaining: FrequencySchema.optional(),
  eatingTogether: FrequencySchema.optional(),
  tvGaming: FrequencySchema.optional(),
  hobbies: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  childrensPlay: z.boolean().optional(),
  homework: z.boolean().optional(),
  cooking: FrequencySchema.optional(),
  notes: z.string().max(1000).optional(),
});
export type Lifestyle = z.infer<typeof LifestyleSchema>;

export const StorageLevelSchema = z.enum(["minimal", "average", "lots"]);

export const PracticalNeedsSchema = z.object({
  storageLevel: StorageLevelSchema.optional(),
  childSafety: z.boolean().optional(),
  petFriendlyMaterials: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});
export type PracticalNeeds = z.infer<typeof PracticalNeedsSchema>;

export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lifestyle: LifestyleSchema,
  practicalNeeds: PracticalNeedsSchema,
  budgetTotalPence: z.number().int().nullable(),
  currency: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Household = z.infer<typeof HouseholdSchema>;

// PUT /profile/household. Each provided field replaces the stored value;
// omitted fields are left unchanged.
export const UpdateHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  lifestyle: LifestyleSchema.optional(),
  practicalNeeds: PracticalNeedsSchema.optional(),
  budgetTotalPence: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .optional(),
});
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;

// ---------------------------------------------------------------------------
// Persons (SE-007: role + age only; no names required)
// ---------------------------------------------------------------------------

export type PersonRole = z.infer<typeof PersonRoleSchema>;

export const PersonRoutinesSchema = z.object({
  worksFromHome: z.boolean().optional(),
  earlyBedtime: z.boolean().optional(),
  naps: z.boolean().optional(),
  usesRooms: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(280).optional(),
});
export type PersonRoutines = z.infer<typeof PersonRoutinesSchema>;

const ageYears = z.number().int().min(0).max(120);

export const CreatePersonSchema = z.object({
  role: PersonRoleSchema,
  // Optional: defaults to e.g. "Child 1". Real names are not needed.
  label: z.string().trim().min(1).max(60).optional(),
  ageYears: ageYears.nullable().optional(),
  routines: PersonRoutinesSchema.optional(),
});
export type CreatePerson = z.infer<typeof CreatePersonSchema>;

export const UpdatePersonSchema = z
  .object({
    role: PersonRoleSchema,
    label: z.string().trim().min(1).max(60),
    ageYears: ageYears.nullable(),
    routines: PersonRoutinesSchema,
  })
  .partial();
export type UpdatePerson = z.infer<typeof UpdatePersonSchema>;

export const PersonSchema = z.object({
  id: z.uuid(),
  role: PersonRoleSchema,
  label: z.string(),
  ageYears: z.number().int().nullable(),
  routines: PersonRoutinesSchema,
  createdAt: isoDate,
});
export type Person = z.infer<typeof PersonSchema>;

// ---------------------------------------------------------------------------
// Accessibility needs (AC-001..AC-003). Functional needs only, never a
// diagnosis. Only confirmed needs become hard layout constraints.
// ---------------------------------------------------------------------------

export const MobilityAidParamsSchema = z.object({
  aidType: z
    .enum([
      "wheelchair",
      "powered_wheelchair",
      "walking_frame",
      "rollator",
      "walking_stick",
      "mobility_scooter",
      "other",
    ])
    .optional(),
  widthCm: cm,
  lengthCm: cm,
});

export const TurningAreaParamsSchema = z.object({ diameterCm: cm });

export const ClearRouteParamsSchema = z.object({ minWidthCm: cm });

export const TransferAreaParamsSchema = z.object({
  widthCm: cm,
  depthCm: cm,
  side: z.enum(["left", "right", "either"]).optional(),
});

export const ReachRangeParamsSchema = z
  .object({
    minCm: z.number().min(0).max(400),
    maxCm: z.number().positive().max(400),
  })
  .refine((v) => v.minCm < v.maxCm, {
    message: "Minimum reach must be below maximum reach",
    path: ["minCm"],
  });

// Free-form preferences for the remaining need types.
export const PreferenceParamsSchema = z.record(
  z.string().min(1).max(40),
  z.union([
    z.string().max(200),
    z.number(),
    z.boolean(),
    z.array(z.string().max(120)).max(20),
  ]),
);

export const ACCESSIBILITY_PARAMS_SCHEMAS = {
  mobility_aid: MobilityAidParamsSchema,
  turning_area: TurningAreaParamsSchema,
  clear_route: ClearRouteParamsSchema,
  transfer_area: TransferAreaParamsSchema,
  reach_range: ReachRangeParamsSchema,
  step_free: PreferenceParamsSchema,
  seating_support: PreferenceParamsSchema,
  trip_hazard_avoidance: PreferenceParamsSchema,
  visual: PreferenceParamsSchema,
  hearing: PreferenceParamsSchema,
  dexterity: PreferenceParamsSchema,
  cognitive: PreferenceParamsSchema,
  sensory: PreferenceParamsSchema,
} as const satisfies Record<
  z.infer<typeof AccessibilityNeedTypeSchema>,
  z.ZodType
>;

export type AccessibilityParams = {
  [K in keyof typeof ACCESSIBILITY_PARAMS_SCHEMAS]: z.infer<
    (typeof ACCESSIBILITY_PARAMS_SCHEMAS)[K]
  >;
};

const accessibilityBase = {
  scope: AccessibilityScopeSchema,
  roomId: z.uuid().nullable().optional(),
  personId: z.uuid().nullable().optional(),
  confirmed: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
};

const needVariant = <K extends keyof typeof ACCESSIBILITY_PARAMS_SCHEMAS>(
  needType: K,
) =>
  z.object({
    ...accessibilityBase,
    needType: z.literal(needType),
    params: ACCESSIBILITY_PARAMS_SCHEMAS[needType],
  });

export const AccessibilityNeedInputSchema = z
  .discriminatedUnion("needType", [
    needVariant("mobility_aid"),
    needVariant("turning_area"),
    needVariant("clear_route"),
    needVariant("transfer_area"),
    needVariant("reach_range"),
    needVariant("step_free"),
    needVariant("seating_support"),
    needVariant("trip_hazard_avoidance"),
    needVariant("visual"),
    needVariant("hearing"),
    needVariant("dexterity"),
    needVariant("cognitive"),
    needVariant("sensory"),
  ])
  .superRefine((v, ctx) => {
    if (v.scope === "room" && !v.roomId) {
      ctx.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Choose the room this need applies to",
      });
    }
    if (v.scope === "person" && !v.personId) {
      ctx.addIssue({
        code: "custom",
        path: ["personId"],
        message: "Choose the person this need applies to",
      });
    }
  });
export type AccessibilityNeedInput = z.infer<
  typeof AccessibilityNeedInputSchema
>;

// PATCH: merged with the stored need and re-validated as a whole.
export const UpdateAccessibilityNeedSchema = z
  .object({
    ...accessibilityBase,
    needType: AccessibilityNeedTypeSchema,
    params: z.record(z.string(), z.unknown()),
  })
  .partial();
export type UpdateAccessibilityNeed = z.infer<
  typeof UpdateAccessibilityNeedSchema
>;

export const AccessibilityNeedSchema = z.object({
  id: z.uuid(),
  scope: AccessibilityScopeSchema,
  roomId: z.uuid().nullable(),
  personId: z.uuid().nullable(),
  needType: AccessibilityNeedTypeSchema,
  params: z.record(z.string(), z.unknown()),
  confirmed: z.boolean(),
  notes: z.string().nullable(),
  createdAt: isoDate,
});
export type AccessibilityNeed = z.infer<typeof AccessibilityNeedSchema>;

// ---------------------------------------------------------------------------
// Existing possessions (FR-11)
// ---------------------------------------------------------------------------

export const CreatePossessionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  widthCm: cm.nullable().optional(),
  depthCm: cm.nullable().optional(),
  heightCm: cm.nullable().optional(),
  // Must be retained in the plan.
  keep: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  roomId: z.uuid().nullable().optional(),
});
export type CreatePossession = z.infer<typeof CreatePossessionSchema>;

export const UpdatePossessionSchema = CreatePossessionSchema.partial();
export type UpdatePossession = z.infer<typeof UpdatePossessionSchema>;

export const PossessionSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid().nullable(),
  name: z.string(),
  category: z.string(),
  widthCm: z.number().nullable(),
  depthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  keep: z.boolean(),
  notes: z.string().nullable(),
  createdAt: isoDate,
});
export type Possession = z.infer<typeof PossessionSchema>;

// ---------------------------------------------------------------------------
// Data export (SE-008)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export type DataExport = {
  format: "deloitful-home-export";
  version: 1;
  exportedAt: string;
  user: UserProfile;
  household: Household | null;
  persons: Person[];
  accessibilityNeeds: AccessibilityNeed[];
  possessions: Possession[];
  homes: Array<
    Row & {
      floors: Row[];
      rooms: Array<Row & { features: Row[]; measurements: Row[] }>;
    }
  >;
  uploads: Row[];
  inspiration: Row[];
  tasteProfile: Row | null;
  briefs: Row[];
  layouts: Row[];
  concepts: Row[];
  recommendations: Array<Row & { product: Row }>;
};
