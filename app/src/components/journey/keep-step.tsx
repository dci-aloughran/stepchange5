"use client";

import { POSSESSION_CATEGORIES, possessionSize } from "@/lib/journey/mapping";
import type { JourneyData, LocalPossession } from "@/lib/journey/types";
import type { UpdateJourney } from "@/lib/journey/use-journey";
import type { PlanRoom } from "@/lib/rooms";
import {
  dashedButton,
  fieldBox,
  fieldLabel,
  inputClass,
  localId,
  Section,
  SelectField,
  subtleButton,
  TextField,
  Toggle,
} from "./ui";

function cmValue(v: string): number | null {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function KeepStep({
  data,
  rooms,
  update,
}: {
  data: JourneyData;
  rooms: PlanRoom[] | null;
  update: UpdateJourney;
}) {
  const items = data.possessions ?? [];
  const roomList = rooms ?? [];
  const setItems = (next: LocalPossession[]) => update("possessions", next);
  const setItem = (id: string, patch: Partial<LocalPossession>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 && (
        <p className="rounded-2xl bg-inset px-4 py-3 text-sm text-muted">
          Nothing added yet. Add furniture you're bringing so the plan works
          around it.
        </p>
      )}
      {items.map((item, i) => (
        <PossessionCard
          key={item.id}
          index={i + 1}
          item={item}
          rooms={roomList}
          onChange={(patch) => setItem(item.id, patch)}
          onRemove={() => setItems(items.filter((x) => x.id !== item.id))}
        />
      ))}
      <button
        type="button"
        className={dashedButton}
        onClick={() =>
          setItems([
            ...items,
            {
              id: localId("item"),
              name: "",
              category: "Sofa",
              widthCm: null,
              depthCm: null,
              heightCm: null,
              roomId: null,
              keep: true,
            },
          ])
        }
      >
        + Add furniture you're keeping
      </button>

      <Section title="Need to find">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Things you still need"
            placeholder="e.g. cot, storage, desk"
            value={data.find ?? ""}
            onChange={(v) => update("find", v)}
          />
        </div>
      </Section>
    </div>
  );
}

function PossessionCard({
  index,
  item,
  rooms,
  onChange,
  onRemove,
}: {
  index: number;
  item: LocalPossession;
  rooms: PlanRoom[];
  onChange: (patch: Partial<LocalPossession>) => void;
  onRemove: () => void;
}) {
  const room = rooms.find((r) => r.id === item.roomId);
  const title = item.name.trim() || `Item ${index}`;
  return (
    <article
      aria-label={`Item ${index}`}
      className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted uppercase">
            {item.keep ? "Keep" : "Maybe"} · {room?.name ?? "Room not set"}
          </p>
          <h2 className="mt-1 font-serif text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-muted">{possessionSize(item)}</p>
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
        <TextField
          label="Item"
          placeholder="e.g. Grey 3-seat sofa"
          value={item.name}
          onChange={(v) => onChange({ name: v })}
        />
        <SelectField
          label="Category"
          value={item.category}
          options={POSSESSION_CATEGORIES.map((c) => ({ value: c, label: c }))}
          onChange={(v) => onChange({ category: v })}
        />
        <SelectField
          label="Room"
          value={item.roomId ?? ""}
          options={[
            { value: "", label: "Not decided yet" },
            ...rooms.map((r) => ({ value: r.id, label: r.name })),
          ]}
          onChange={(v) => onChange({ roomId: v || null })}
        />
        <TextField
          label="Width (cm)"
          numeric
          wide={false}
          placeholder="e.g. 210"
          value={item.widthCm == null ? "" : String(item.widthCm)}
          onChange={(v) => onChange({ widthCm: cmValue(v) })}
        />
        <TextField
          label="Depth (cm)"
          numeric
          wide={false}
          placeholder="e.g. 95"
          value={item.depthCm == null ? "" : String(item.depthCm)}
          onChange={(v) => onChange({ depthCm: cmValue(v) })}
        />
        <TextField
          label="Height (cm)"
          numeric
          wide={false}
          placeholder="e.g. 85"
          value={item.heightCm == null ? "" : String(item.heightCm)}
          onChange={(v) => onChange({ heightCm: cmValue(v) })}
        />
      </div>
      <p className="-mt-2 text-xs text-muted">
        Measure the outside edges, including arms and legs.
      </p>
      <Toggle
        label="Must keep — plan around it"
        checked={item.keep}
        onChange={(v) => onChange({ keep: v })}
      />
      <label className={fieldBox}>
        <span className={fieldLabel}>Condition / notes (optional)</span>
        <textarea
          className={`${inputClass} min-h-16 resize-y`}
          maxLength={500}
          value={item.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </label>
    </article>
  );
}
