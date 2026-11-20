"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InspirationStep } from "@/components/taste/inspiration-step";
import { TasteStep } from "@/components/taste/taste-step";
import { reviewedRoomMap } from "@/lib/journey/mapping";
import { patchJourney, readRooms, writeRooms } from "@/lib/journey/store";
import type { JourneyData } from "@/lib/journey/types";
import { useJourneyData, useJourneySync } from "@/lib/journey/use-journey";
import { Brand } from "./brand";
import { AccessStep } from "./journey/access-step";
import { BudgetStep } from "./journey/budget-step";
import { CreatePlan } from "./journey/create-plan";
import { KeepStep } from "./journey/keep-step";
import { NeedsStep } from "./journey/needs-step";
import { ReviewStep } from "./journey/review-step";
import { SyncStatusLine } from "./journey/sync-status";
import { basicsFrom, RoomsStep } from "./rooms-step";
import { GROUPS, STEPS, type Step } from "./steps";

export type { JourneyData } from "@/lib/journey/types";

function Stepper({ current }: { current: Step["group"] }) {
  const idx = GROUPS.indexOf(current);
  return (
    <ol className="grid grid-cols-6 gap-1 rounded-3xl border border-white/10 bg-card p-2">
      {GROUPS.map((g, i) => (
        <li
          key={g}
          aria-current={i === idx ? "step" : undefined}
          className={`flex flex-col items-center rounded-2xl py-2 text-[11px] ${i <= idx ? "bg-cream text-ink" : "text-muted"}`}
        >
          <span className="text-base font-medium">{i < idx ? "✓" : i + 1}</span>
          {g}
        </li>
      ))}
    </ol>
  );
}

const primary =
  "min-h-14 rounded-3xl bg-cream text-lg font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-60";

export function Journey({ slug }: { slug: string }) {
  const router = useRouter();
  const { data, rooms, update, loaded } = useJourneyData();
  const sync = useJourneySync();
  const index = Math.max(
    0,
    STEPS.findIndex((s) => s.slug === slug),
  );
  const step = STEPS[index] as Step;
  const next = STEPS[index + 1];
  const prev = STEPS[index - 1];
  const [roomsSave, setRoomsSave] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  // MB-005: remember where the user is so another device can resume here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per step
  useEffect(() => {
    if (loaded && data.lastStep !== slug) update("lastStep", slug);
  }, [loaded, slug]);

  const value = (k: string) => {
    const v = data[k as keyof JourneyData];
    return typeof v === "string" ? v : "";
  };
  const goNext = () => router.push(next ? `/journey/${next.slug}` : "/plan");

  async function confirmRooms(skipSave = false) {
    const current = readRooms() ?? rooms ?? [];
    patchJourney({ reviewedRooms: reviewedRoomMap(current) });
    if (sync.isSignedIn && sync.ready && !skipSave) {
      setRoomsSave({ kind: "saving" });
      try {
        await sync.syncNow();
      } catch (e) {
        setRoomsSave({
          kind: "error",
          message: e instanceof Error ? e.message : "Saving failed.",
        });
        return;
      }
    }
    setRoomsSave({ kind: "idle" });
    goNext();
  }

  const restored = sync.restored;
  const resumeStep =
    restored?.restored && restored.lastStep && restored.lastStep !== slug
      ? STEPS.find((s) => s.slug === restored.lastStep)
      : undefined;

  return (
    <main
      className={`relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 overflow-hidden px-5 pt-8 pb-6 ${step.slug === "home" ? "text-foreground" : ""}`}
    >
      {step.slug === "home" && (
        <>
          <Image
            src="/images/property-photograph.png"
            alt=""
            fill
            priority
            sizes="(min-width: 448px) 448px, 100vw"
            className="-z-20 object-cover"
          />
          <div className="-z-10 absolute inset-0 bg-gradient-to-b from-background/80 via-background/40 to-background" />
        </>
      )}
      <Brand trailing="Preview" />
      <Stepper current={step.group} />
      <SyncStatusLine
        isLoaded={sync.isLoaded}
        isSignedIn={sync.isSignedIn}
        onRetry={() => void sync.syncNow().catch(() => {})}
      />
      {restored?.restored && (
        <section className="rounded-3xl border border-white/10 bg-card p-4 text-sm">
          <p>Welcome back. We've restored your answers from your account.</p>
          {resumeStep && (
            <Link
              href={`/journey/${resumeStep.slug}`}
              className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4"
            >
              Continue where you left off: {resumeStep.title}
            </Link>
          )}
        </section>
      )}
      <header className="flex flex-col gap-3">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          {step.eyebrow}
        </p>
        <h1 className="font-serif text-4xl leading-tight">{step.title}</h1>
        <p className="text-muted">{step.intro}</p>
      </header>

      {(step.fields || step.choices) && (
        <section className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-card p-4">
          {step.choices?.map((choice) => (
            <fieldset key={choice.key} className="flex flex-col gap-2">
              <legend className="mb-2 text-xs tracking-[0.2em] text-muted uppercase">
                {choice.label}
              </legend>
              <div className="flex flex-wrap gap-2">
                {choice.options.map((o) => {
                  const selected = value(choice.key) === o;
                  return (
                    <button
                      type="button"
                      key={o}
                      aria-pressed={selected}
                      onClick={() =>
                        update(choice.key as "journey" | "propertyType", o)
                      }
                      className={`min-h-11 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-cream ${selected ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {step.fields && (
            <div className="grid grid-cols-2 gap-3">
              {step.fields.map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  value={value(f.key)}
                  onChange={(v) => update(f.key as "address", v)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {loaded && step.custom === "rooms" && (
        <RoomsStep data={data} update={update} loaded={loaded} />
      )}
      {loaded && step.custom === "needs" && (
        <NeedsStep data={data} update={update} />
      )}
      {loaded && step.custom === "access" && (
        <AccessStep data={data} rooms={rooms} update={update} />
      )}
      {step.custom === "inspiration" && <InspirationStep />}
      {step.custom === "taste" && <TasteStep />}
      {loaded && step.custom === "keep" && (
        <KeepStep data={data} rooms={rooms} update={update} />
      )}
      {loaded && step.custom === "budget" && (
        <BudgetStep data={data} update={update} />
      )}
      {loaded && step.custom === "review" && (
        <ReviewStep
          data={data}
          rooms={rooms}
          api={sync.api}
          isSignedIn={sync.isSignedIn}
        />
      )}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {step.custom === "review" ? (
          <CreatePlan sync={sync} label={step.cta ?? "Create my plan"} />
        ) : step.custom === "rooms" ? (
          <>
            {roomsSave.kind === "error" && (
              <div
                role="alert"
                className="rounded-3xl bg-amber-900/40 p-4 text-sm text-amber-100"
              >
                <p>We couldn't save your rooms: {roomsSave.message}</p>
                <button
                  type="button"
                  onClick={() => void confirmRooms(true)}
                  className="mt-2 min-h-11 underline underline-offset-4"
                >
                  Continue anyway (saved on this device)
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={roomsSave.kind === "saving"}
              onClick={() => void confirmRooms()}
              className={primary}
            >
              {roomsSave.kind === "saving"
                ? "Saving your rooms…"
                : roomsSave.kind === "error"
                  ? "Try again"
                  : (step.cta ?? "Continue")}
            </button>
          </>
        ) : (
          <button type="button" onClick={goNext} className={primary}>
            {step.cta ?? "Continue"}
          </button>
        )}
        <Link
          href={prev ? `/journey/${prev.slug}` : "/"}
          className="inline-flex min-h-11 items-center text-muted"
        >
          ‹ Back
        </Link>
      </div>
    </main>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: NonNullable<Step["fields"]>[number];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label
        className={`flex flex-col gap-1 rounded-2xl bg-inset p-4 focus-within:ring-2 focus-within:ring-cream/60 ${field.wide ? "col-span-2" : ""}`}
      >
        <span className="text-xs tracking-[0.15em] text-muted uppercase">
          {field.label}
        </span>
        <input
          className="bg-transparent text-lg outline-none placeholder:text-white/35"
          placeholder={field.placeholder}
          inputMode={field.numeric ? "numeric" : undefined}
          value={value}
          onChange={(e) =>
            onChange(
              field.numeric
                ? e.target.value.replace(/[^0-9.]/g, "")
                : e.target.value,
            )
          }
        />
      </label>
    </>
  );
}
