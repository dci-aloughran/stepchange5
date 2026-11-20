"use client";

import type { Frequency } from "@stepchange/shared";
import { useState } from "react";
import { personLabel } from "@/lib/journey/mapping";
import type {
  JourneyData,
  LocalLifestyle,
  LocalPerson,
  LocalPractical,
} from "@/lib/journey/types";
import type { UpdateJourney } from "@/lib/journey/use-journey";
import {
  Chips,
  chipClass,
  dashedButton,
  fieldBox,
  fieldLabel,
  inputClass,
  localId,
  Section,
  subtleButton,
  Toggle,
} from "./ui";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "occasionally", label: "Sometimes" },
  { value: "regularly", label: "Often" },
  { value: "daily", label: "Daily" },
];

const ROLES: { value: LocalPerson["role"]; label: string }[] = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
  { value: "regular_visitor", label: "Regular visitor" },
];

export function NeedsStep({
  data,
  update,
}: {
  data: JourneyData;
  update: UpdateJourney;
}) {
  const people = data.people ?? [];
  const lifestyle = data.lifestyle ?? {};
  const practical = data.practical ?? {};

  const setPeople = (next: LocalPerson[]) => update("people", next);
  const setPerson = (id: string, patch: Partial<LocalPerson>) =>
    setPeople(people.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const setLife = (patch: Partial<LocalLifestyle>) =>
    update("lifestyle", { ...lifestyle, ...patch });
  const setPractical = (patch: Partial<LocalPractical>) =>
    update("practical", { ...practical, ...patch });

  const add = (role: LocalPerson["role"]) =>
    setPeople([...people, { id: localId("person"), role, ageYears: null }]);

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Your household"
        intro="Add everyone who lives here or visits often. No names needed: a role and age is enough."
      >
        {people.length === 0 && (
          <p className="text-sm text-muted">No one added yet.</p>
        )}
        <ul className="flex flex-col gap-3">
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              title={personLabel(people, person)}
              onChange={(patch) => setPerson(person.id, patch)}
              onRemove={() =>
                setPeople(people.filter((p) => p.id !== person.id))
              }
            />
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
          <button
            type="button"
            className={dashedButton}
            onClick={() => add("adult")}
          >
            + Adult
          </button>
          <button
            type="button"
            className={dashedButton}
            onClick={() => add("child")}
          >
            + Child
          </button>
          <button
            type="button"
            className={dashedButton}
            onClick={() => add("regular_visitor")}
          >
            + Visitor
          </button>
        </div>
      </Section>

      <Section
        title="How you'll use the space"
        intro="This shapes which rooms need desks, dining space or play areas."
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm">Work from home (days a week)</legend>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((n) => {
              const on = lifestyle.wfhDaysPerWeek === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${n} days a week`}
                  className={`${chipClass(on)} min-w-11`}
                  onClick={() =>
                    setLife({ wfhDaysPerWeek: on ? undefined : n })
                  }
                >
                  {n === 5 ? "5+" : n}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Chips
          legend="Entertaining guests"
          options={FREQUENCIES}
          value={lifestyle.entertaining}
          onChange={(v) => setLife({ entertaining: v })}
        />
        <Chips
          legend="Eating together at a table"
          options={FREQUENCIES}
          value={lifestyle.eatingTogether}
          onChange={(v) => setLife({ eatingTogether: v })}
        />
        <Chips
          legend="TV and gaming"
          options={FREQUENCIES}
          value={lifestyle.tvGaming}
          onChange={(v) => setLife({ tvGaming: v })}
        />
        <Chips
          legend="Cooking"
          options={FREQUENCIES}
          value={lifestyle.cooking}
          onChange={(v) => setLife({ cooking: v })}
        />
        <Toggle
          label="Space for children's play"
          checked={Boolean(lifestyle.childrensPlay)}
          onChange={(v) => setLife({ childrensPlay: v })}
        />
        <Toggle
          label="Somewhere for homework"
          checked={Boolean(lifestyle.homework)}
          onChange={(v) => setLife({ homework: v })}
        />
        <HobbiesField
          value={lifestyle.hobbies ?? []}
          onChange={(hobbies) => setLife({ hobbies })}
        />
      </Section>

      <Section title="Practical needs">
        <Chips
          legend="Storage"
          options={[
            { value: "minimal", label: "Minimal" },
            { value: "average", label: "Average" },
            { value: "lots", label: "Lots" },
          ]}
          value={practical.storageLevel}
          onChange={(v) => setPractical({ storageLevel: v })}
        />
        <Toggle
          label="Child safety"
          hint="Anchored furniture, rounded corners, safe storage."
          checked={Boolean(practical.childSafety)}
          onChange={(v) => setPractical({ childSafety: v })}
        />
        <Toggle
          label="Pet-friendly materials"
          hint="Scratch- and stain-resistant fabrics."
          checked={Boolean(practical.petFriendlyMaterials)}
          onChange={(v) => setPractical({ petFriendlyMaterials: v })}
        />
        <label className={fieldBox}>
          <span className={fieldLabel}>Anything else (optional)</span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            maxLength={600}
            placeholder="e.g. Mum helps with childcare twice a week"
            value={practical.notes ?? ""}
            onChange={(e) => setPractical({ notes: e.target.value })}
          />
        </label>
      </Section>
    </div>
  );
}

function PersonCard({
  person,
  title,
  onChange,
  onRemove,
}: {
  person: LocalPerson;
  title: string;
  onChange: (patch: Partial<LocalPerson>) => void;
  onRemove: () => void;
}) {
  const ageId = `age-${person.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg">{title}</h3>
        <button
          type="button"
          className={subtleButton}
          onClick={onRemove}
          aria-label={`Remove ${title}`}
        >
          Remove
        </button>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Role for {title}</legend>
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={person.role === r.value}
            className={chipClass(person.role === r.value)}
            onClick={() => onChange({ role: r.value })}
          >
            {r.label}
          </button>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        {!(person.role === "child" && person.onTheWay) && (
          <label className={fieldBox} htmlFor={ageId}>
            <span className={fieldLabel}>Age (optional)</span>
            <input
              id={ageId}
              className={inputClass}
              inputMode="numeric"
              placeholder="Years"
              value={person.ageYears ?? ""}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value.replace(/\D/g, ""));
                onChange({
                  ageYears: Number.isFinite(n) ? Math.min(120, n) : null,
                });
              }}
            />
          </label>
        )}
        <label className={fieldBox}>
          <span className={fieldLabel}>Called (optional)</span>
          <input
            className={inputClass}
            maxLength={60}
            placeholder={person.role === "regular_visitor" ? "e.g. Mum" : ""}
            value={person.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </label>
      </div>
      {person.role === "child" && (
        <Toggle
          label="On the way"
          hint="We'll plan for a newborn."
          checked={Boolean(person.onTheWay)}
          onChange={(v) =>
            onChange({ onTheWay: v, ageYears: v ? 0 : person.ageYears })
          }
        />
      )}
      {person.role === "adult" && (
        <Toggle
          label="Works from home"
          checked={Boolean(person.worksFromHome)}
          onChange={(v) => onChange({ worksFromHome: v })}
        />
      )}
    </li>
  );
}

function HobbiesField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className={fieldBox}>
      <span className={fieldLabel}>Hobbies that need space (optional)</span>
      <input
        className={inputClass}
        placeholder="e.g. cycling, sewing, piano"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
      <span className="text-xs text-muted">Separate with commas.</span>
    </label>
  );
}
