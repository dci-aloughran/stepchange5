export type Field = {
  key: string;
  label: string;
  placeholder?: string;
  wide?: boolean;
  numeric?: boolean;
};
export type Choice = {
  key: string;
  label: string;
  options: string[];
  single?: boolean;
};
export type Step = {
  slug: string;
  group: (typeof GROUPS)[number];
  eyebrow: string;
  title: string;
  intro: string;
  fields?: Field[];
  choices?: Choice[];
  custom?:
    | "rooms"
    | "needs"
    | "access"
    | "inspiration"
    | "taste"
    | "keep"
    | "budget"
    | "review";
  cta?: string;
};

export const GROUPS = [
  "Home",
  "Needs",
  "Style",
  "Keep",
  "Budget",
  "Review",
] as const;

export const STEPS: Step[] = [
  {
    slug: "home",
    group: "Home",
    eyebrow: "01 / Home",
    title: "Start with the real place.",
    intro: "A few details now, fewer expensive mistakes later.",
    choices: [
      {
        key: "journey",
        label: "I'm…",
        options: ["Buying a home", "Already a homeowner"],
        single: true,
      },
      {
        key: "propertyType",
        label: "Property type",
        options: ["House", "Flat", "Bungalow", "Maisonette"],
        single: true,
      },
    ],
    fields: [
      {
        key: "address",
        label: "Address or name",
        placeholder: "Flat 2, 18 Rowan Court",
        wide: true,
      },
      { key: "beds", label: "Bedrooms", placeholder: "3", numeric: true },
      { key: "baths", label: "Bathrooms", placeholder: "1", numeric: true },
      {
        key: "area",
        label: "Floor area (m²)",
        placeholder: "58",
        numeric: true,
      },
      { key: "price", label: "Price (£)", placeholder: "165,000" },
    ],
  },
  {
    slug: "rooms",
    group: "Home",
    eyebrow: "01 / Check your home",
    title: "Review every room.",
    intro:
      "Upload a floor plan or edit the rooms yourself. Measurements you confirm are used; estimates are flagged.",
    custom: "rooms",
    cta: "Use these rooms",
  },
  {
    slug: "needs",
    group: "Needs",
    eyebrow: "02 / Household needs",
    title: "Make room for real life.",
    intro:
      "Who's here now, and who's on the way? Start with how you'll use the space.",
    custom: "needs",
  },
  {
    slug: "access",
    group: "Needs",
    eyebrow: "02 / Accessibility needs",
    title: "Space that includes everyone.",
    intro:
      "Optional and private. We ask to plan usable routes and room layouts, not to identify a diagnosis. Confirmed needs become hard layout rules.",
    custom: "access",
  },
  {
    slug: "style",
    group: "Style",
    eyebrow: "03 / Style inspiration",
    title: "Show us what you love.",
    intro:
      "Add boards, photos or products. We'll interpret your taste — you correct it.",
    custom: "inspiration",
  },
  {
    slug: "taste",
    group: "Style",
    eyebrow: "03 / Your interpreted taste",
    title: "Your taste, interpreted.",
    intro:
      "Here's what we took from your inspiration. Adjust anything that's off.",
    custom: "taste",
  },
  {
    slug: "keep",
    group: "Keep",
    eyebrow: "04 / Keep & find",
    title: "Keep the good stuff.",
    intro:
      "Furniture you keep is planned around first. We only look for what's missing.",
    custom: "keep",
  },
  {
    slug: "budget",
    group: "Budget",
    eyebrow: "05 / Budget & constraints",
    title: "A plan within reach.",
    intro: "A whole-home budget keeps every room honest.",
    custom: "budget",
  },
  {
    slug: "review",
    group: "Review",
    eyebrow: "06 / Review",
    title: "The whole picture.",
    intro:
      "Check the brief before exploring what a plan could look like. Tap any section to revisit it.",
    custom: "review",
    cta: "Create my plan",
  },
];
