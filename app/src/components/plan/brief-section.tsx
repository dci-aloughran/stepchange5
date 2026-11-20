"use client";

import type {
  Brief,
  FurnitureRequirementDto,
  FurnitureRequirementInput,
  RoomDetail,
} from "@stepchange/shared";
import Link from "next/link";
import { useState } from "react";
import {
  formatBounds,
  formatPenceRange,
  parseOptionalNumber,
  titleCase,
} from "@/lib/plan/format";
import { isMeasurementRequest } from "@/lib/plan/status";
import { readJson, useServer } from "@/lib/server";
import {
  btnPrimary,
  btnQuiet,
  btnSecondary,
  Card,
  Eyebrow,
  errorMessage,
  fieldBox,
  fieldInput,
  fieldLabel,
  Notice,
  Pill,
  Working,
} from "./ui";

const PRIORITY_TEXT = {
  must: "Must have",
  should: "Should have",
  could: "Nice to have",
};
const PRIORITY_TONE = { must: "ok", should: "info", could: "none" } as const;
const BRIEF_STATUS = {
  draft: { label: "Draft · needs your review", tone: "warn" },
  accepted: { label: "Accepted", tone: "ok" },
  edited: { label: "Edited by you", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
} as const;

export function BriefSection({
  room,
  brief,
  onBrief,
}: {
  room: RoomDetail;
  brief: Brief | null;
  onBrief: (b: Brief | null) => void;
}) {
  const { client } = useServer();
  const [busy, setBusy] = useState<null | "generate" | "save" | "accept">(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const reviewed = room.reviewedAt != null;

  async function generate(allowUnreviewed: boolean) {
    setBusy("generate");
    setError(null);
    setStatus("Creating your room brief…");
    try {
      const res = await client.plans.rooms[":roomId"].brief.$post({
        param: { roomId: room.id },
        query: allowUnreviewed ? { allowUnreviewed: "true" } : {},
      });
      const { brief: b } = await readJson<{ brief: Brief }>(res);
      onBrief(b);
      setStatus("Brief ready. Check it, then accept or edit it.");
    } catch (e) {
      setError(errorMessage(e, "Couldn't create the brief."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function patch(
    body: {
      requirements?: FurnitureRequirementInput[];
      status?: "accepted" | "edited" | "rejected";
    },
    kind: "save" | "accept",
    done: string,
  ) {
    if (!brief) return false;
    setBusy(kind);
    setError(null);
    try {
      const res = await client.plans.briefs[":briefId"].$patch({
        param: { briefId: brief.id },
        json: body,
      });
      const { brief: b } = await readJson<{ brief: Brief }>(res);
      onBrief(b);
      setStatus(done);
      return true;
    } catch (e) {
      setError(errorMessage(e, "Couldn't save the brief."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const saveRequirements = (reqs: FurnitureRequirementInput[], done: string) =>
    patch({ requirements: reqs }, "save", done);

  return (
    <Card id="brief" aria-labelledby="brief-heading" className="scroll-mt-4">
      <Eyebrow>1 · Functional brief</Eyebrow>
      <h2 id="brief-heading" className="font-serif text-2xl">
        What this room needs to do
      </h2>

      {!brief && busy !== "generate" && (
        <>
          <p className="text-sm text-muted">
            We draft a brief from your household, accessibility needs, the
            things you're keeping and this room's size, doors and windows. You
            review it before anything else happens.
          </p>
          {!reviewed && (
            <Notice tone="warn" title="This room hasn't been reviewed">
              <p>
                Check its size, doors and windows first so the brief is based on
                the real room.
              </p>
              <Link href="/journey/rooms" className="underline">
                Review rooms
              </Link>
            </Notice>
          )}
          {reviewed ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void generate(false)}
            >
              Create brief
            </button>
          ) : (
            <button
              type="button"
              className={btnSecondary}
              onClick={() => void generate(true)}
            >
              Create a draft brief anyway
            </button>
          )}
        </>
      )}

      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {busy === "generate" && (
          <Working
            label="Drafting the brief with AI…"
            expected="Usually 10–30 seconds."
          />
        )}
        {status && busy !== "generate" && (
          <p className="text-muted">{status}</p>
        )}
      </div>
      {error && (
        <Notice tone="bad" role="alert">
          <p>{error}</p>
        </Notice>
      )}

      {brief && busy !== "generate" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={BRIEF_STATUS[brief.status].tone}>
              {BRIEF_STATUS[brief.status].label}
            </Pill>
            <span className="text-xs text-muted">
              Version {brief.version}
              {brief.modelVersion ? " · drafted by AI, checked by rules" : ""}
            </span>
          </div>

          {brief.uncertainties.length > 0 && (
            <Uncertainties items={brief.uncertainties} />
          )}

          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className={fieldLabel}>Household need</dt>
              <dd className="mt-1">{brief.householdNeed}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Recommended use</dt>
              <dd className="mt-1">{brief.recommendedUse}</dd>
            </div>
            {brief.roomConstraints.length > 0 && (
              <div>
                <dt className={fieldLabel}>Room constraints</dt>
                <dd className="mt-1">
                  <ul className="list-disc space-y-1 pl-5 text-muted">
                    {brief.roomConstraints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>

          <h3 className="mt-2 text-lg">Furniture requirements</h3>
          <p className="-mt-2 text-xs text-muted">
            Sizes are the most that fits; prices are estimates, not live prices.
          </p>
          <ul className="flex flex-col gap-2">
            {brief.requirements.map((r) => (
              <li key={r.id}>
                {editing === r.id ? (
                  <RequirementForm
                    initial={r}
                    busy={busy === "save"}
                    onCancel={() => setEditing(null)}
                    onSave={async (next) => {
                      const ok = await saveRequirements(
                        brief.requirements.map((x) =>
                          x.id === r.id ? { ...x, ...next } : x,
                        ),
                        `Saved changes to ${r.category}.`,
                      );
                      if (ok) setEditing(null);
                    }}
                  />
                ) : (
                  <RequirementCard
                    r={r}
                    disabled={busy !== null}
                    onEdit={() => setEditing(r.id)}
                    onRemove={() =>
                      void saveRequirements(
                        brief.requirements.filter((x) => x.id !== r.id),
                        `Removed ${r.category}.`,
                      )
                    }
                  />
                )}
              </li>
            ))}
            {brief.requirements.length === 0 && (
              <li className="text-sm text-muted">No requirements yet.</li>
            )}
          </ul>
          {editing === "new" ? (
            <RequirementForm
              busy={busy === "save"}
              onCancel={() => setEditing(null)}
              onSave={async (next) => {
                const ok = await saveRequirements(
                  [...brief.requirements, next],
                  `Added ${next.category}.`,
                );
                if (ok) setEditing(null);
              }}
            />
          ) : (
            <button
              type="button"
              className={btnSecondary}
              disabled={busy !== null || brief.requirements.length >= 40}
              onClick={() => setEditing("new")}
            >
              + Add a requirement
            </button>
          )}

          <div className="mt-2 flex flex-col gap-2">
            {(brief.status === "draft" || brief.status === "rejected") && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy !== null || brief.status === "rejected"}
                onClick={() =>
                  void patch(
                    { status: "accepted" },
                    "accept",
                    "Brief accepted. Next, plan the layout.",
                  )
                }
              >
                {busy === "accept" ? "Accepting…" : "Accept brief"}
              </button>
            )}
            <button
              type="button"
              className={btnQuiet}
              disabled={busy !== null}
              onClick={() => void generate(!reviewed)}
            >
              Create a new version
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function Uncertainties({ items }: { items: string[] }) {
  const measure = items.filter(isMeasurementRequest);
  const other = items.filter((u) => !isMeasurementRequest(u));
  return (
    <div className="flex flex-col gap-2">
      {measure.length > 0 && (
        <Notice tone="warn" title="Please measure or confirm">
          <ul className="list-disc space-y-1 pl-5">
            {measure.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Notice>
      )}
      {other.length > 0 && (
        <Notice tone="info" title="Things we weren't sure about">
          <ul className="list-disc space-y-1 pl-5">
            {other.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

function RequirementCard({
  r,
  disabled,
  onEdit,
  onRemove,
}: {
  r: FurnitureRequirementDto;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const bounds = formatBounds(r);
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-inset p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-medium">
          {titleCase(r.category)}
          {r.quantity > 1 && (
            <span className="text-muted"> × {r.quantity}</span>
          )}
        </h4>
        <Pill tone={PRIORITY_TONE[r.priority]}>
          {PRIORITY_TEXT[r.priority]}
        </Pill>
      </div>
      <p className="text-sm">{r.description}</p>
      <p className="text-xs text-muted">
        {bounds ? `Size: ${bounds}` : "No size limit"}
        {r.estimatedPricePence &&
          ` · Estimate ${formatPenceRange(r.estimatedPricePence.low, r.estimatedPricePence.high)}${r.quantity > 1 ? " each" : ""}`}
        {r.retainedPossessionId && " · You're keeping your own"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={btnQuiet}
          disabled={disabled}
          onClick={onEdit}
          aria-label={`Edit ${r.category}`}
        >
          Edit
        </button>
        <button
          type="button"
          className={btnQuiet}
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove ${r.category}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

type FormState = {
  category: string;
  description: string;
  quantity: string;
  priority: "must" | "should" | "could";
  minWidthCm: string;
  maxWidthCm: string;
  maxDepthCm: string;
  maxHeightCm: string;
};

const str = (n: number | undefined) => (n == null ? "" : String(Math.round(n)));

export function validateRequirementForm(
  f: FormState,
):
  | { ok: true; value: Omit<FurnitureRequirementInput, "id"> }
  | { ok: false; error: string } {
  const category = f.category.trim();
  const description = f.description.trim();
  if (!category) return { ok: false, error: "Give the item a name." };
  if (!description) return { ok: false, error: "Describe what it's for." };
  const quantity = Number(f.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    return {
      ok: false,
      error: "Quantity must be a whole number from 1 to 20.",
    };
  }
  const dims: Record<string, number | undefined> = {};
  for (const key of [
    "minWidthCm",
    "maxWidthCm",
    "maxDepthCm",
    "maxHeightCm",
  ] as const) {
    const v = parseOptionalNumber(f[key]);
    if (v !== undefined && (!Number.isFinite(v) || v <= 0 || v > 5000)) {
      return { ok: false, error: "Sizes must be between 1 and 5000 cm." };
    }
    dims[key] = v;
  }
  if (
    dims.minWidthCm !== undefined &&
    dims.maxWidthCm !== undefined &&
    dims.minWidthCm > dims.maxWidthCm
  ) {
    return { ok: false, error: "Minimum width can't be more than maximum." };
  }
  return {
    ok: true,
    value: {
      category: category.slice(0, 60),
      description: description.slice(0, 500),
      quantity,
      priority: f.priority,
      minWidthCm: dims.minWidthCm,
      maxWidthCm: dims.maxWidthCm,
      maxDepthCm: dims.maxDepthCm,
      maxHeightCm: dims.maxHeightCm,
    },
  };
}

function RequirementForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: FurnitureRequirementDto;
  busy: boolean;
  onSave: (r: FurnitureRequirementInput) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>({
    category: initial?.category ?? "",
    description: initial?.description ?? "",
    quantity: String(initial?.quantity ?? 1),
    priority: initial?.priority ?? "should",
    minWidthCm: str(initial?.minWidthCm),
    maxWidthCm: str(initial?.maxWidthCm),
    maxDepthCm: str(initial?.maxDepthCm),
    maxHeightCm: str(initial?.maxHeightCm),
  });
  const [error, setError] = useState<string | null>(null);
  const set =
    (k: keyof FormState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));
  const id = initial?.id ?? "new";

  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-2xl border border-cream/30 bg-inset p-3"
      aria-label={initial ? `Edit ${initial.category}` : "New requirement"}
      onSubmit={(e) => {
        e.preventDefault();
        const v = validateRequirementForm(f);
        if (!v.ok) {
          setError(v.error);
          return;
        }
        setError(null);
        void onSave({
          ...(initial ?? {}),
          ...v.value,
          // Keep fields the form doesn't edit (estimate, retained item).
          estimatedPricePence: initial?.estimatedPricePence,
          retainedPossessionId: initial?.retainedPossessionId,
        });
      }}
    >
      <label className={`${fieldBox} col-span-2`} htmlFor={`cat-${id}`}>
        <span className={fieldLabel}>Item</span>
        <input
          id={`cat-${id}`}
          className={fieldInput}
          value={f.category}
          onChange={set("category")}
          maxLength={60}
          readOnly={initial != null}
          placeholder="e.g. Bookcase"
        />
      </label>
      <label className={`${fieldBox} col-span-2`} htmlFor={`desc-${id}`}>
        <span className={fieldLabel}>Description</span>
        <textarea
          id={`desc-${id}`}
          className={`${fieldInput} min-h-16`}
          value={f.description}
          onChange={set("description")}
          maxLength={500}
        />
      </label>
      <label className={fieldBox} htmlFor={`qty-${id}`}>
        <span className={fieldLabel}>Quantity</span>
        <input
          id={`qty-${id}`}
          className={fieldInput}
          inputMode="numeric"
          value={f.quantity}
          onChange={set("quantity")}
        />
      </label>
      <label className={fieldBox} htmlFor={`pri-${id}`}>
        <span className={fieldLabel}>Priority</span>
        <select
          id={`pri-${id}`}
          className={fieldInput}
          value={f.priority}
          onChange={set("priority")}
        >
          <option value="must" className="text-ink">
            Must have
          </option>
          <option value="should" className="text-ink">
            Should have
          </option>
          <option value="could" className="text-ink">
            Nice to have
          </option>
        </select>
      </label>
      {(
        [
          ["minWidthCm", "Min width (cm)"],
          ["maxWidthCm", "Max width (cm)"],
          ["maxDepthCm", "Max depth (cm)"],
          ["maxHeightCm", "Max height (cm)"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className={fieldBox} htmlFor={`${k}-${id}`}>
          <span className={fieldLabel}>{label}</span>
          <input
            id={`${k}-${id}`}
            className={fieldInput}
            inputMode="decimal"
            value={f[k]}
            onChange={set(k)}
            placeholder="No limit"
          />
        </label>
      ))}
      {error && (
        <p role="alert" className="col-span-2 text-sm text-amber-200">
          {error}
        </p>
      )}
      <div className="col-span-2 flex gap-2">
        <button
          type="submit"
          className={`${btnPrimary} flex-1`}
          disabled={busy}
        >
          {busy ? "Saving…" : initial ? "Save requirement" : "Add requirement"}
        </button>
        <button type="button" className={btnQuiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
