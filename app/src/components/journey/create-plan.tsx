"use client";

import { SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { STAGE_LABELS, type SyncStage } from "@/lib/journey/sync";
import type { useJourneySync } from "@/lib/journey/use-journey";

const PENDING_KEY = "deloitful.createPlanPending";
const ORDER: SyncStage[] = [
  "home",
  "rooms",
  "household",
  "access",
  "furniture",
  "progress",
];

const primary =
  "min-h-14 w-full rounded-3xl bg-cream text-lg font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-60";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; reached: number }
  | { kind: "error"; message: string };

// "Create my plan": make sure the user is signed in, save everything to the
// server, then go to the plan.
export function CreatePlan({
  sync,
  label,
}: {
  sync: ReturnType<typeof useJourneySync>;
  label: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const running = useRef(false);
  const { syncNow, ready, isLoaded, isSignedIn } = sync;

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPhase({ kind: "running", reached: 0 });
    try {
      await syncNow((stage) =>
        setPhase((p) => ({
          kind: "running",
          reached: Math.max(
            p.kind === "running" ? p.reached : 0,
            ORDER.indexOf(stage),
          ),
        })),
      );
      router.push("/plan");
    } catch (e) {
      setPhase({
        kind: "error",
        message:
          e instanceof Error && e.message
            ? e.message
            : "Something went wrong while saving.",
      });
    } finally {
      running.current = false;
    }
  }, [router, syncNow]);

  // Continue automatically after signing in from this button.
  useEffect(() => {
    if (!ready) return;
    if (sessionStorage.getItem(PENDING_KEY)) {
      sessionStorage.removeItem(PENDING_KEY);
      void run();
    }
  }, [ready, run]);

  if (!isLoaded) {
    return (
      <button type="button" disabled className={primary}>
        Checking sign-in…
      </button>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex flex-col gap-2">
        <SignInButton mode="modal">
          <button
            type="button"
            className={primary}
            onClick={() => sessionStorage.setItem(PENDING_KEY, "1")}
          >
            Sign in to create my plan
          </button>
        </SignInButton>
        <p className="text-sm text-muted">
          Your answers are saved on this device. Sign in to keep them in your
          account and build your plan.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {phase.kind === "running" && (
        <div className="rounded-3xl border border-white/10 bg-card p-4">
          <output className="block font-medium">
            {STAGE_LABELS[ORDER[phase.reached] ?? "home"]}…
          </output>
          <progress
            className="mt-3 h-2 w-full overflow-hidden rounded-full"
            value={phase.reached + 1}
            max={ORDER.length + 1}
            aria-label="Saving progress"
          />
        </div>
      )}
      {phase.kind === "error" && (
        <div
          role="alert"
          className="rounded-3xl bg-amber-900/40 p-4 text-sm text-amber-100"
        >
          <p className="font-medium">We couldn't save your brief.</p>
          <p className="mt-1">{phase.message}</p>
          <p className="mt-1">
            Your answers are still on this device. Try again in a moment.
          </p>
        </div>
      )}
      <button
        type="button"
        className={primary}
        disabled={!ready || phase.kind === "running"}
        onClick={() => void run()}
      >
        {!ready
          ? "Getting your account ready…"
          : phase.kind === "running"
            ? "Saving…"
            : phase.kind === "error"
              ? "Try again"
              : label}
      </button>
    </div>
  );
}
