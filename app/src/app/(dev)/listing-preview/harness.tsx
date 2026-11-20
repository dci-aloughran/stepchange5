"use client";

import type { ListingExtractResponse } from "@stepchange/shared";
import { useState } from "react";
import { ListingPreview } from "@/components/listing/listing-preview";

export function ListingPreviewHarness() {
  const [applied, setApplied] = useState<ListingExtractResponse | null>(null);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-6">
      <ListingPreview onApply={setApplied} />
      {applied && (
        <pre data-testid="applied" className="text-xs whitespace-pre-wrap">
          {JSON.stringify(applied.details)}
        </pre>
      )}
    </main>
  );
}
