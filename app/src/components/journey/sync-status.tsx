"use client";

import { SignInButton } from "@clerk/nextjs";
import { type SyncStatus, useSyncStatus } from "@/lib/journey/use-journey";

function text(status: SyncStatus): string {
  switch (status.state) {
    case "saving":
      return "Saving to your account…";
    case "saved":
      return "Saved to your account";
    case "error":
      return `Couldn't save to your account: ${status.message}`;
    default:
      return "Signed in · changes save to your account";
  }
}

// One-line save status. Uses <output> (an implicit polite live region).
export function SyncStatusLine({
  isLoaded,
  isSignedIn,
  onRetry,
}: {
  isLoaded: boolean;
  isSignedIn: boolean;
  onRetry: () => void;
}) {
  const status = useSyncStatus();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <output>Answers saved on this device.</output>
        <SignInButton mode="modal">
          <button
            type="button"
            className="min-h-11 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-cream"
          >
            Sign in to save them to your account
          </button>
        </SignInButton>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <output
        className={status.state === "error" ? "text-amber-200" : "text-muted"}
      >
        {text(status)}
      </output>
      {status.state === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-cream"
        >
          Try again
        </button>
      )}
    </div>
  );
}
