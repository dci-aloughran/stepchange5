"use client";

import type { ListingExtractResponse } from "@stepchange/shared";

// Listing preview built from screenshots / pasted listing text the user
// shares. Rendered on the home step; calls onApply when the user accepts the
// details so the journey can fill in home fields and seed rooms.
export function ListingPreview(_props: {
  onApply: (result: ListingExtractResponse) => void;
}) {
  return null;
}
