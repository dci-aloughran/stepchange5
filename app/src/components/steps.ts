export type Field = {
  key: string;
  label: string;
  placeholder?: string;
  wide?: boolean;
};
export type Step = {
  slug: string;
  group: (typeof GROUPS)[number];
  eyebrow: string;
  title: string;
  intro: string;
  fields?: Field[];
  choices?: { key: string; label: string; options: string[] };
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
    eyebrow: "01 / Your home",
    title: "Which home are we planning?",
    intro: "A home you're thinking of buying, or the one you live in now.",
    choices: {
      key: "journey",
      label: "I'm…",
      options: ["Buying a home", "Already a homeowner"],
    },
    fields: [
      {
        key: "address",
        label: "Address or name",
        placeholder: "Flat 2, 18 Rowan Court",
        wide: true,
      },
      { key: "beds", label: "Bedrooms", placeholder: "2" },
      { key: "baths", label: "Bathrooms", placeholder: "1" },
      { key: "area", label: "Floor area (m²)", placeholder: "58" },
      { key: "price", label: "Price (£)", placeholder: "165,000" },
    ],
  },
  {
    slug: "rooms",
    group: "Home",
    eyebrow: "01 / Review your rooms",
    title: "Check the rooms we've found.",
    intro:
      "Add or correct rooms. Measurements you confirm are used; estimates are flagged.",
    fields: [
      {
        key: "room1",
        label: "Living room (W × L cm)",
        placeholder: "480 × 370",
      },
      { key: "room2", label: "Bedroom 1 (W × L cm)", placeholder: "360 × 320" },
      {
        key: "room3",
        label: "Bedroom 2 (W × L cm)",
        placeholder: "Unknown — measure",
      },
      {
        key: "room4",
        label: "Kitchen / diner (W × L cm)",
        placeholder: "410 × 300",
      },
    ],
  },
  {
    slug: "needs",
    group: "Needs",
    eyebrow: "02 / Household needs",
    title: "Make room for real life.",
    intro:
      "Who's here now, and who's on the way? Start with how you'll use the space.",
    fields: [
      { key: "adults", label: "Adults", placeholder: "2 · you + Dan" },
      { key: "children", label: "Children", placeholder: "1 baby on the way" },
      {
        key: "ages",
        label: "Age / due date",
        placeholder: "Due May 2027",
        wide: true,
      },
      { key: "pets", label: "Pets", placeholder: "None", wide: true },
      {
        key: "guests",
        label: "Regular guests",
        placeholder: "Mum visits weekly",
        wide: true,
      },
      {
        key: "wfh",
        label: "Work from home",
        placeholder: "2 days/week",
        wide: true,
      },
    ],
  },
  {
    slug: "access",
    group: "Needs",
    eyebrow: "02 / Accessibility needs",
    title: "Space that works for everyone.",
    intro: "Confirmed needs become hard layout rules. No diagnosis needed.",
    choices: {
      key: "accessNeeds",
      label: "Needs to plan for",
      options: [
        "Wheelchair turning space",
        "Step-free routes",
        "Clear transfer space",
        "Reach range",
        "Trip-hazard free",
      ],
    },
    fields: [
      {
        key: "accessNotes",
        label: "Who and where",
        placeholder: "Mum's wheelchair: living room and bathroom",
        wide: true,
      },
    ],
  },
  {
    slug: "style",
    group: "Style",
    eyebrow: "03 / Style inspiration",
    title: "Show us what you love.",
    intro:
      "Add boards, photos or products. We'll interpret your taste — you correct it.",
    fields: [
      {
        key: "pinterest",
        label: "Pinterest / Instagram link",
        placeholder: "https://…",
        wide: true,
      },
      {
        key: "loves",
        label: "Love",
        placeholder: "Natural oak, warm neutrals, muted greens",
        wide: true,
      },
      {
        key: "dislikes",
        label: "Don't love",
        placeholder: "High gloss, busy patterns",
        wide: true,
      },
    ],
  },
  {
    slug: "taste",
    group: "Style",
    eyebrow: "03 / Your interpreted taste",
    title: "Warm contemporary, mostly.",
    intro:
      "Here's what we took from your inspiration. Adjust anything that's off.",
    choices: {
      key: "taste",
      label: "Keep what sounds like you",
      options: [
        "Natural oak",
        "Warm neutrals",
        "Muted greens",
        "Textured fabrics",
        "Rounded forms",
        "Minimal clutter",
        "Black accents, sparingly",
      ],
    },
  },
  {
    slug: "keep",
    group: "Keep",
    eyebrow: "04 / Keep & find",
    title: "What's coming with you?",
    intro:
      "Furniture you keep is planned around first. We only find what's missing.",
    fields: [
      {
        key: "keep1",
        label: "Keeping",
        placeholder: "Grey 3-seat sofa · 210 cm",
        wide: true,
      },
      {
        key: "keep2",
        label: "Keeping",
        placeholder: "Oak dining table · 160 × 90 cm",
        wide: true,
      },
      {
        key: "find",
        label: "Need to find",
        placeholder: "Cot, storage, desk",
        wide: true,
      },
    ],
  },
  {
    slug: "budget",
    group: "Budget",
    eyebrow: "05 / Budget & constraints",
    title: "Spend where it counts.",
    intro: "A whole-home budget keeps every room honest.",
    fields: [
      {
        key: "budget",
        label: "Total furnishing budget (£)",
        placeholder: "6,000",
        wide: true,
      },
      {
        key: "timing",
        label: "Timing",
        placeholder: "Nursery by April",
        wide: true,
      },
    ],
    choices: {
      key: "priorities",
      label: "Priorities",
      options: [
        "Child-friendly",
        "Durable",
        "Second-hand welcome",
        "Delivered quickly",
      ],
    },
  },
  {
    slug: "review",
    group: "Review",
    eyebrow: "06 / Review",
    title: "The whole picture.",
    intro:
      "Check the brief before exploring what a plan could look like. Tap any section to revisit it.",
    cta: "Create my plan",
  },
];
