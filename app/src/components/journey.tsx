"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Brand } from "./brand";
import { RoomsStep } from "./rooms-step";
import { GROUPS, STEPS, type Step } from "./steps";

const STORAGE_KEY = "deloitful.journey";

export type JourneyData = Record<string, string | string[]>;

export function useJourneyState() {
  const [data, setData] = useState<JourneyData>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      setData(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
    } catch {}
    setLoaded(true);
  }, []);
  const update = (key: string, value: string | string[]) => {
    setData((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return { data, update, loaded };
}

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

export function Journey({ slug }: { slug: string }) {
  const router = useRouter();
  const { data, update, loaded } = useJourneyState();
  const index = Math.max(
    0,
    STEPS.findIndex((s) => s.slug === slug),
  );
  const step = STEPS[index] as Step;
  const next = STEPS[index + 1];
  const prev = STEPS[index - 1];

  const value = (k: string) =>
    typeof data[k] === "string" ? (data[k] as string) : "";
  const list = (k: string) =>
    Array.isArray(data[k]) ? (data[k] as string[]) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-6">
      <Brand trailing="Preview" />
      <Stepper current={step.group} />
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
                  const selected = choice.single
                    ? value(choice.key) === o
                    : list(choice.key).includes(o);
                  return (
                    <button
                      type="button"
                      key={o}
                      aria-pressed={selected}
                      onClick={() => {
                        if (choice.single) return update(choice.key, o);
                        const cur = list(choice.key);
                        update(
                          choice.key,
                          selected ? cur.filter((x) => x !== o) : [...cur, o],
                        );
                      }}
                      className={`min-h-11 rounded-full border px-4 text-sm ${selected ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
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
                <label
                  key={f.key}
                  className={`flex flex-col gap-1 rounded-2xl bg-inset p-4 ${f.wide ? "col-span-2" : ""}`}
                >
                  <span className="text-xs tracking-[0.15em] text-muted uppercase">
                    {f.label}
                  </span>
                  <input
                    className="bg-transparent text-lg outline-none placeholder:text-white/35"
                    placeholder={f.placeholder}
                    inputMode={f.numeric ? "numeric" : undefined}
                    value={value(f.key)}
                    onChange={(e) =>
                      update(
                        f.key,
                        f.numeric
                          ? e.target.value.replace(/[^0-9.]/g, "")
                          : e.target.value,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {step.custom === "rooms" && (
        <RoomsStep data={data} update={update} loaded={loaded} />
      )}

      {step.slug === "review" && <Review data={data} />}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        <button
          type="button"
          onClick={() => router.push(next ? `/journey/${next.slug}` : "/plan")}
          className="min-h-14 rounded-3xl bg-cream text-lg font-semibold text-ink"
        >
          {step.cta ?? "Continue"}
        </button>
        <Link
          href={prev ? `/journey/${prev.slug}` : "/"}
          className="text-muted"
        >
          ‹ Back
        </Link>
      </div>
    </main>
  );
}

function Review({ data }: { data: Record<string, string | string[]> }) {
  const s = (k: string, fallback: string) => {
    const v = data[k];
    if (Array.isArray(v)) return v.length ? v.join(", ") : fallback;
    return v || fallback;
  };
  const cards = [
    {
      n: "01",
      label: "Home",
      slug: "home",
      title: s("address", "Your home"),
      body: `${s("propertyType", "Home")} · ${s("beds", "?")} beds · ${s("baths", "?")} bath · ${s("area", "?")} m² · ${s("journey", "")}`,
    },
    {
      n: "02",
      label: "Household & access",
      slug: "needs",
      title: `${s("adults", "Adults")} · ${s("children", "no children")}`,
      body: `${s("guests", "")} ${s("accessNeeds", "No confirmed access needs")}`,
    },
    {
      n: "03",
      label: "Style",
      slug: "taste",
      title: s("taste", "Taste not set"),
      body: `Love: ${s("loves", "—")} · Avoid: ${s("dislikes", "—")}`,
    },
    {
      n: "04",
      label: "Keep",
      slug: "keep",
      title:
        [s("keep1", ""), s("keep2", "")].filter(Boolean).join(" · ") ||
        "Nothing kept",
      body: `Find: ${s("find", "—")}`,
    },
    {
      n: "05",
      label: "Budget",
      slug: "budget",
      title: `£${s("budget", "—")}`,
      body: `${s("timing", "")} ${s("priorities", "")}`,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {cards.map((c) => (
        <Link
          key={c.n}
          href={`/journey/${c.slug}`}
          className="rounded-3xl border border-white/10 bg-card p-5"
        >
          <p className="text-xs tracking-[0.2em] text-muted uppercase">
            {c.n} {c.label} ↗
          </p>
          <h2 className="mt-3 font-serif text-2xl">{c.title}</h2>
          <p className="mt-2 text-sm text-muted">{c.body}</p>
        </Link>
      ))}
    </div>
  );
}
