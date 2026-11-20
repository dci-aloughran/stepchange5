// Category heuristics shared by brief post-checks and the layout validator.
// Categories are free text from the model or the user, so matching is
// deliberately forgiving.

const NON_FLOOR =
  /(pendant|ceiling|wall light|wall lamp|sconce|table lamp|lampshade|lamp shade|wall art|artwork|art print|picture|frame|mirror|curtain|blind|cushion|throw|bedding|duvet|pillow|accessor|decor|ornament|vase|clock|wall shel|floating shel|wall-mounted|wall mounted|television|\btv\b|houseplant|plant)/i;

const RUG = /\b(rug|runner|carpet|mat)\b/i;

const STORAGE =
  /(storage|wardrobe|cupboard|shelv|shelf|bookcase|book case|chest|drawer|dresser|cabinet|sideboard|media unit|tv unit|credenza|toy box|ottoman|basket|tallboy|bureau|unit)/i;

const TALL =
  /(wardrobe|bookcase|book case|shelving|tall|dresser|tallboy|cabinet)/i;

const TRANSFER_TARGET = /(\bbed\b|sofa|settee|couch|armchair|recliner)/i;

export function isFloorItem(category: string, description = ""): boolean {
  if (/floor lamp|standing lamp/i.test(`${category} ${description}`)) {
    return true;
  }
  return !NON_FLOOR.test(category);
}

export function isRug(category: string): boolean {
  return RUG.test(category);
}

export function isStorage(category: string): boolean {
  return STORAGE.test(category) && !RUG.test(category);
}

export function isTall(category: string, heightCm?: number | null): boolean {
  if (heightCm != null) return heightCm > 110;
  return TALL.test(category);
}

export function isTransferTarget(category: string, appliesTo?: string[]) {
  if (appliesTo && appliesTo.length > 0) {
    const c = category.toLowerCase();
    return appliesTo.some((a) => c.includes(a.toLowerCase()));
  }
  return TRANSFER_TARGET.test(category);
}

// Typical footprints (width x depth, cm) used only when a requirement has no
// size bounds. Items using these are never "known" dimensions.
const DEFAULTS: Array<[RegExp, number, number]> = [
  [/corner sofa/i, 250, 180],
  [/sofa bed/i, 200, 95],
  [/sofa|settee|couch/i, 210, 95],
  [/armchair|accent chair|occasional chair|recliner/i, 80, 85],
  [/coffee table/i, 110, 60],
  [/side table|bedside|nightstand/i, 50, 45],
  [/dining table/i, 160, 90],
  [/dining chair|chair|stool/i, 50, 55],
  [/desk/i, 120, 60],
  [/super ?king/i, 180, 200],
  [/king/i, 150, 200],
  [/single bed|bunk/i, 90, 190],
  [/cot\b|crib/i, 70, 130],
  [/bed/i, 135, 190],
  [/wardrobe/i, 100, 60],
  [/chest|drawer|dresser|tallboy/i, 80, 45],
  [/bookcase|shelv/i, 80, 35],
  [/media|tv unit/i, 160, 45],
  [/sideboard|credenza/i, 150, 45],
  [/rug|carpet/i, 200, 290],
  [/floor lamp|standing lamp/i, 40, 40],
  [/ottoman|pouffe|footstool/i, 60, 60],
  [/storage|cabinet|unit|toy/i, 100, 40],
];

export function defaultFootprint(category: string): {
  widthCm: number;
  depthCm: number;
} {
  for (const [re, w, d] of DEFAULTS) {
    if (re.test(category)) return { widthCm: w, depthCm: d };
  }
  return { widthCm: 60, depthCm: 60 };
}
