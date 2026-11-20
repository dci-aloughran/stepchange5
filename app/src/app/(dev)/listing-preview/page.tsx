import { notFound } from "next/navigation";
import { ListingPreviewHarness } from "./harness";

// Development-only page for exercising the listing preview in isolation.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ListingPreviewHarness />;
}
