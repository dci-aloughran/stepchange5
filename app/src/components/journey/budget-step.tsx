"use client";

import { formatPounds, poundsToPence } from "@/lib/journey/mapping";
import type { JourneyData } from "@/lib/journey/types";
import type { UpdateJourney } from "@/lib/journey/use-journey";
import { chipClass, Section, TextField } from "./ui";

const QUICK = [3000, 6000, 10000];
const PRIORITIES = [
  "Child-friendly",
  "Durable",
  "Second-hand welcome",
  "Delivered quickly",
  "Easy to clean",
  "Sustainable materials",
];

function formatInput(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 7);
  return digits ? Number(digits).toLocaleString("en-GB") : "";
}

export function BudgetStep({
  data,
  update,
}: {
  data: JourneyData;
  update: UpdateJourney;
}) {
  const pence = poundsToPence(data.budget);
  const priorities = data.priorities ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-card p-5">
        <label className="flex flex-col gap-2" htmlFor="budget-total">
          <span className="text-xs tracking-[0.2em] text-muted uppercase">
            Total furnishing budget (£)
          </span>
          <span className="flex items-baseline gap-1 rounded-2xl bg-inset px-4 py-2 focus-within:ring-2 focus-within:ring-cream/60">
            <span aria-hidden className="font-serif text-4xl text-muted">
              £
            </span>
            <input
              id="budget-total"
              className="w-full bg-transparent font-serif text-5xl outline-none placeholder:text-white/25"
              inputMode="numeric"
              placeholder="0"
              value={data.budget ?? ""}
              onChange={(e) => update("budget", formatInput(e.target.value))}
            />
          </span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {QUICK.map((q) => {
            const on = pence === q * 100;
            return (
              <button
                key={q}
                type="button"
                aria-pressed={on}
                className={`min-h-12 rounded-2xl text-sm focus-visible:outline-2 focus-visible:outline-cream ${on ? "bg-cream text-ink" : "bg-white/5 text-muted"}`}
                onClick={() => update("budget", q.toLocaleString("en-GB"))}
              >
                {formatPounds(q * 100)}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted">
          Furnishings only. Excludes moving costs, building work and access
          adaptations.
        </p>
      </section>

      <Section title="Priorities">
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => {
            const on = priorities.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                className={chipClass(on)}
                onClick={() =>
                  update(
                    "priorities",
                    on ? priorities.filter((x) => x !== p) : [...priorities, p],
                  )
                }
              >
                {p}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Timing (optional)"
            placeholder="e.g. Nursery ready by April"
            value={data.timing ?? ""}
            onChange={(v) => update("timing", v)}
          />
        </div>
      </Section>
    </div>
  );
}
