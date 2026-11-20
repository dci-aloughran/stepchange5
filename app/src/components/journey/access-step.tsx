"use client";

import type { AccessibilityNeedType } from "@stepchange/shared";
import Link from "next/link";
import {
  NEED_TYPES,
  needProblem,
  needSummary,
  needTypeInfo,
  personLabel,
} from "@/lib/journey/mapping";
import type { JourneyData, LocalNeed } from "@/lib/journey/types";
import type { UpdateJourney } from "@/lib/journey/use-journey";
import type { PlanRoom } from "@/lib/rooms";
import {
  chipClass,
  dashedButton,
  fieldBox,
  fieldLabel,
  inputClass,
  localId,
  SelectField,
  subtleButton,
  TextField,
  Toggle,
} from "./ui";

const SCOPES: { value: LocalNeed["scope"]; label: string }[] = [
  { value: "home", label: "Whole home" },
  { value: "room", label: "A room" },
  { value: "person", label: "A person" },
];

export function AccessStep({
  data,
  rooms,
  update,
}: {
  data: JourneyData;
  rooms: PlanRoom[] | null;
  update: UpdateJourney;
}) {
  const needs = data.needs ?? [];
  const people = data.people ?? [];
  const roomList = rooms ?? [];

  const setNeeds = (next: LocalNeed[]) => update("needs", next);
  const setNeed = (id: string, patch: Partial<LocalNeed>) =>
    setNeeds(needs.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl border border-white/10 bg-card p-5 text-sm text-muted">
        <p>
          Tell us what the space needs to allow, like turning room for a
          wheelchair or a clear route width. We don't need to know why.
        </p>
        <p className="mt-2">
          Only <strong className="text-foreground">confirmed</strong> needs
          are treated as hard layout rules. Others guide the plan as
          preferences.
        </p>
      </section>

      {needs.length === 0 && (
        <p className="rounded-2xl bg-inset px-4 py-3 text-sm text-muted">
          No accessibility needs added. That's fine: you can continue, or add
          one below.
        </p>
      )}

      {needs.map((need, i) => (
        <NeedCard
          key={need.id}
          index={i + 1}
          need={need}
          rooms={roomList}
          people={people.map((p) => ({
            id: p.id,
            label: personLabel(people, p),
          }))}
          problem={needProblem(
            need,
            roomList.map((r) => r.id),
            people.map((p) => p.id),
          )}
          onChange={(patch) => setNeed(need.id, patch)}
          onRemove={() => setNeeds(needs.filter((n) => n.id !== need.id))}
        />
      ))}

      <button
        type="button"
        className={dashedButton}
        onClick={() =>
          setNeeds([
            ...needs,
            {
              id: localId("need"),
              needType: "turning_area",
              scope: "home",
              params: {},
              confirmed: false,
            },
          ])
        }
      >
        + Add an accessibility need
      </button>
    </div>
  );
}

function NeedCard({
  index,
  need,
  rooms,
  people,
  problem,
  onChange,
  onRemove,
}: {
  index: number;
  need: LocalNeed;
  rooms: PlanRoom[];
  people: { id: string; label: string }[];
  problem: string | null;
  onChange: (patch: Partial<LocalNeed>) => void;
  onRemove: () => void;
}) {
  const info = needTypeInfo(need.needType);
  const title = `Need ${index}`;
  const setParam = (key: string, value: string) =>
    onChange({ params: { ...need.params, [key]: value || undefined } });

  return (
    <article
      aria-label={title}
      className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted uppercase">
            {title}
            {need.confirmed ? " · hard rule" : " · preference"}
          </p>
          <h2 className="mt-1 font-serif text-2xl">{needSummary(need)}</h2>
        </div>
        <button
          type="button"
          className={subtleButton}
          onClick={onRemove}
          aria-label={`Remove ${title}`}
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="What to plan for"
          value={need.needType}
          options={NEED_TYPES.map((t) => ({ value: t.type, label: t.label }))}
          onChange={(v) =>
            onChange({ needType: v as AccessibilityNeedType, params: {} })
          }
        />
        <p className="col-span-2 -mt-1 text-sm text-muted">{info.hint}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm">Where does it apply?</legend>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={need.scope === s.value}
              className={chipClass(need.scope === s.value)}
              onClick={() => onChange({ scope: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      {need.scope === "room" &&
        (rooms.length ? (
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Room"
              value={need.roomId ?? ""}
              options={[
                { value: "", label: "Choose a room…" },
                ...rooms.map((r) => ({ value: r.id, label: r.name })),
              ]}
              onChange={(v) => onChange({ roomId: v || null })}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/journey/rooms" className="underline">
              Add your rooms
            </Link>{" "}
            first, or choose the whole home.
          </p>
        ))}
      {need.scope === "person" &&
        (people.length ? (
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Person"
              value={need.personId ?? ""}
              options={[
                { value: "", label: "Choose a person…" },
                ...people.map((p) => ({ value: p.id, label: p.label })),
              ]}
              onChange={(v) => onChange({ personId: v || null })}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/journey/needs" className="underline">
              Add your household
            </Link>{" "}
            first, or choose the whole home.
          </p>
        ))}

      <div className="grid grid-cols-2 gap-3">
        {info.fields.map((f) =>
          f.kind === "select" ? (
            <SelectField
              key={f.key}
              label={f.label}
              value={String(need.params[f.key] ?? "")}
              options={[
                { value: "", label: "Not sure" },
                ...(f.options ?? []),
              ]}
              onChange={(v) => setParam(f.key, v)}
            />
          ) : (
            <TextField
              key={f.key}
              label={f.label}
              value={String(need.params[f.key] ?? "")}
              placeholder={f.placeholder}
              numeric={f.kind === "cm"}
              wide={f.kind !== "cm" || info.fields.length === 1}
              onChange={(v) => setParam(f.key, v)}
            />
          ),
        )}
      </div>

      <Toggle
        label="Confirmed — treat as a hard layout rule"
        hint="Only confirm what you're sure of, ideally measured. Layouts that can't meet a confirmed need are flagged, never shown as a fit."
        checked={need.confirmed}
        onChange={(v) => onChange({ confirmed: v })}
      />

      <label className={fieldBox}>
        <span className={fieldLabel}>Notes (optional)</span>
        <textarea
          className={`${inputClass} min-h-16 resize-y`}
          maxLength={500}
          placeholder="No medical details needed"
          value={need.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </label>

      {problem && (
        <p
          role="status"
          className="rounded-2xl bg-amber-900/40 px-4 py-3 text-sm text-amber-100"
        >
          Incomplete, so not used in plans yet: {problem}
        </p>
      )}
    </article>
  );
}
