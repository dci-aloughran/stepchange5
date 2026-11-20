// Pure normaliser: UCP catalog product (Shopify Global/Storefront Catalog MCP)
// -> FR-21 product record. No I/O.

export const CONNECTOR = "shopify_ucp";
export const LICENCE_STATUS = "display_with_attribution";

type Money = { amount?: number; currency?: string };
type Media = { type?: string; url?: string };
type Option = { name?: string; label?: string };
export type UcpVariant = {
  id?: string;
  title?: string;
  url?: string;
  checkout_url?: string;
  seller_product_id?: string;
  price?: Money;
  availability?: { available?: boolean };
  options?: Option[];
  media?: Media[];
  seller?: { name?: string; domain?: string; url?: string };
  placement?: unknown;
  source?: string;
};
export type UcpProduct = {
  id?: string;
  title?: string;
  url?: string;
  description?: { plain?: string; html?: string };
  media?: Media[];
  categories?: Array<{ value?: string } | string>;
  metadata?: {
    attributes?: Array<{ name?: string; value?: unknown; values?: unknown }>;
    tech_specs?: string[];
  };
  variants?: UcpVariant[];
};

export type NormalisedProduct = {
  retailer: string;
  connector: string;
  sourceProductId: string;
  sourceVariantId: string;
  upid: string | null;
  title: string;
  description: string | null;
  category: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  dimensionStatus: "source_printed" | "estimated" | "unknown";
  colour: string | null;
  material: string | null;
  pricePence: number | null;
  currency: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  imageUrls: string[];
  deliversToUk: boolean | null;
  canonicalUrl: string | null;
  checkoutUrl: string | null;
  licenceStatus: string;
  sponsored: boolean;
  retrievedAt: Date;
};

export function stripHtml(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<(br|\/p|\/li|\/h\d|\/div|li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&times;/g, "x")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

// Sub-component lines (drawers, legs, seat...) must not be taken as overall
// dimensions.
const COMPONENT =
  /\b(drawer|leg|seat|arm|shelf|shelves|cushion|back|internal|interior|box|packag|carton|parcel|door|compartment|cabinet opening|headboard)\w*/i;

function toCm(value: number, unit: string | undefined): number {
  const u = (unit ?? "cm").toLowerCase();
  if (u === "mm") return value / 10;
  if (u === "m") return value * 100;
  if (u.startsWith("in") || u === '"') return Math.round(value * 254) / 100;
  return value;
}

type Dims = { widthCm?: number; depthCm?: number; heightCm?: number };

// Parse only explicitly labelled dimensions (W/D/H, Width/Depth/Height).
export function parseLabelledDims(line: string): Dims {
  const dims: Dims = {};
  const re =
    /\(?\b(width|depth|height|length|w|d|h|l)\b\)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|in|inches|")?/gi;
  const unitMatch = line.match(/\d\s*(cm|mm|in|inches)\b/i);
  const fallbackUnit = unitMatch?.[1];
  for (const m of line.matchAll(re)) {
    const label = (m[1] ?? "").toLowerCase();
    const value = Number(m[2]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const cm = toCm(value, m[3] ?? fallbackUnit);
    if (cm < 1 || cm > 1000) continue;
    if ((label === "w" || label === "width") && dims.widthCm === undefined)
      dims.widthCm = cm;
    else if (
      (label === "l" || label === "length") &&
      dims.widthCm === undefined
    )
      dims.widthCm = cm;
    else if ((label === "d" || label === "depth") && dims.depthCm === undefined)
      dims.depthCm = cm;
    else if (
      (label === "h" || label === "height") &&
      dims.heightCm === undefined
    )
      dims.heightCm = cm;
  }
  return dims;
}

function countDims(d: Dims) {
  return [d.widthCm, d.depthCm, d.heightCm].filter((v) => v !== undefined)
    .length;
}

export function extractDims(
  title: string,
  descriptionText: string,
  techSpecs: string[] | undefined,
): Dims & { status: NormalisedProduct["dimensionStatus"] } {
  const lines = [title, ...descriptionText.split("\n")];
  let best: Dims | null = null;
  for (const line of lines) {
    if (!/\d/.test(line)) continue;
    if (COMPONENT.test(line) && !/\boverall\b/i.test(line)) continue;
    const d = parseLabelledDims(line);
    if (countDims(d) >= 2) {
      best = d;
      if (/\b(overall|size|dimensions?)\b/i.test(line)) break;
      if (best && countDims(best) === 3) break;
    }
  }
  if (best) return { ...best, status: "source_printed" };
  // Shopify-inferred tech specs are not retailer-printed.
  for (const line of techSpecs ?? []) {
    if (COMPONENT.test(line)) continue;
    const d = parseLabelledDims(line);
    if (countDims(d) >= 2) return { ...d, status: "estimated" };
  }
  return { status: "unknown" };
}

function optionValue(options: Option[] | undefined, names: RegExp) {
  const o = options?.find((x) => x.name && names.test(x.name));
  return o?.label && o.label !== "Default Title" ? o.label : null;
}

function attributeValue(p: UcpProduct, names: RegExp): string | null {
  const a = p.metadata?.attributes?.find((x) => x.name && names.test(x.name));
  if (!a) return null;
  const v = a.value ?? a.values;
  if (Array.isArray(v)) return v.map(String).join(", ") || null;
  return typeof v === "string" ? v : null;
}

export function stripQuery(id: string): string {
  const i = id.indexOf("?");
  return i === -1 ? id : id.slice(0, i);
}

export type NormaliseOptions = {
  retrievedAt: Date;
  // True when the request applied ships_to=GB (Global Catalog filter).
  shipsToGbFiltered: boolean;
  // Retailer label for storefront results without seller info.
  storefrontDomain?: string;
};

// One record per variant. Variants without a usable id are dropped.
export function normaliseProduct(
  p: UcpProduct,
  opts: NormaliseOptions,
): NormalisedProduct[] {
  const out: NormalisedProduct[] = [];
  if (!p.id || !p.title) return out;
  const description = stripHtml(p.description?.plain ?? p.description?.html);
  const dims = extractDims(p.title, description, p.metadata?.tech_specs);
  const category =
    p.categories
      ?.map((c) => (typeof c === "string" ? c : c.value))
      .find(Boolean)
      ?.split(">")
      .pop()
      ?.trim() ?? null;
  const productImages = (p.media ?? [])
    .filter((m) => (m.type ?? "image") === "image" && m.url)
    .map((m) => m.url as string);
  const isUpid = p.id.startsWith("gid://shopify/p/");

  for (const v of p.variants ?? []) {
    if (!v.id) continue;
    const currency = v.price?.currency ?? null;
    const amount = v.price?.amount;
    const variantImages = (v.media ?? [])
      .filter((m) => (m.type ?? "image") === "image" && m.url)
      .map((m) => m.url as string);
    const external = v.source === "external";
    const sourceProductId = stripQuery(
      v.seller_product_id ?? (isUpid ? p.id : p.id),
    );
    const variantTitle =
      v.title && v.title !== "Default Title" && v.title !== p.title
        ? ` - ${v.title}`
        : "";
    out.push({
      retailer:
        v.seller?.name ??
        v.seller?.domain ??
        opts.storefrontDomain ??
        "Unknown",
      connector: CONNECTOR,
      sourceProductId,
      sourceVariantId: stripQuery(v.id),
      upid: isUpid ? p.id : null,
      title: `${p.title}${variantTitle}`,
      description: description ? description.slice(0, 4000) : null,
      category,
      widthCm: dims.widthCm ?? null,
      depthCm: dims.depthCm ?? null,
      heightCm: dims.heightCm ?? null,
      dimensionStatus: dims.status,
      colour:
        optionValue(v.options, /^colou?r$/i) ?? attributeValue(p, /^colou?r$/i),
      material: attributeValue(p, /^material$/i),
      pricePence:
        typeof amount === "number" && Number.isInteger(amount) ? amount : null,
      currency,
      // External offers don't track stock (Shopify docs).
      availability: external
        ? "unknown"
        : v.availability?.available === true
          ? "in_stock"
          : v.availability?.available === false
            ? "out_of_stock"
            : "unknown",
      imageUrls: (variantImages.length ? variantImages : productImages).slice(
        0,
        6,
      ),
      deliversToUk:
        opts.shipsToGbFiltered && currency === "GBP" && !external ? true : null,
      // Attribution parameters must be kept intact (Shopify usage rules).
      canonicalUrl: v.url ?? p.url ?? null,
      checkoutUrl: v.checkout_url ?? null,
      licenceStatus: LICENCE_STATUS,
      sponsored: v.placement !== undefined && v.placement !== null,
      retrievedAt: opts.retrievedAt,
    });
  }
  return out;
}
