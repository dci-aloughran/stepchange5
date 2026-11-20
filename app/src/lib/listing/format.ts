import type { ListingDetails } from "@stepchange/shared";

export function formatPrice(pence: number | null): string | null {
  if (pence == null) return null;
  return `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
}

const TYPE_LABELS: Record<
  NonNullable<ListingDetails["propertyType"]>,
  string
> = {
  house: "House",
  flat: "Flat",
  bungalow: "Bungalow",
  maisonette: "Maisonette",
};

export function propertyTypeLabel(d: ListingDetails): string | null {
  if (d.propertySubtype) return d.propertySubtype;
  return d.propertyType ? TYPE_LABELS[d.propertyType] : null;
}

export type FactRow = { label: string; value: string | null };

// The headline facts shown on the preview card, in display order. A null
// value is rendered as "Not shown" — we never fill gaps.
export function factRows(d: ListingDetails): FactRow[] {
  const price = formatPrice(d.pricePence);
  return [
    {
      label: "Price",
      value: price ? [d.priceQualifier, price].filter(Boolean).join(" ") : null,
    },
    { label: "Address", value: d.address },
    { label: "Type", value: propertyTypeLabel(d) },
    {
      label: "Bedrooms",
      value: d.bedrooms == null ? null : String(d.bedrooms),
    },
    {
      label: "Bathrooms",
      value: d.bathrooms == null ? null : String(d.bathrooms),
    },
    {
      label: "Receptions",
      value: d.receptions == null ? null : String(d.receptions),
    },
    {
      label: "Floor area",
      value: d.floorAreaSqm == null ? null : `${d.floorAreaSqm} m²`,
    },
    { label: "Tenure", value: d.tenure },
  ];
}

export function isListingFile(file: File): boolean {
  return /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type);
}
