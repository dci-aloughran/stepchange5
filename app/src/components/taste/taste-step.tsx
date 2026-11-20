"use client";

// Owned by the taste work (design screens 09/17): AI-interpreted taste
// profile the user can correct (FR-08).
import type {
  InspirationItem,
  TasteDerivationBasis,
  TasteDeriveRequest,
  TasteProfile,
  TasteProfileUpdate,
} from "@stepchange/shared";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { readJson, useServer } from "@/lib/server";
import { readTasteDraft } from "@/lib/taste/draft";
import {
  categoryKeyFor,
  categoryLabel,
  confidenceWording,
  coreAttributes,
  describeDiff,
  diffAttributes,
  type EditableAttribute,
  friendlyError,
  hasInterpretation,
  parseList,
  splitLikesAndAvoids,
  statusWording,
  TASTE_CATEGORIES,
  toAttributeInputs,
  toEditable,
} from "@/lib/taste/taste";
import {
  Card,
  Checking,
  primaryButton,
  SignInCard,
  secondaryButton,
  textInput,
} from "./shared";

type Load =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function TasteStep() {
  const { isLoaded, isSignedIn } = useServer();
  if (!isLoaded) return <Checking>Checking sign-in…</Checking>;
  if (!isSignedIn) {
    return (
      <SignInCard title="Sign in to see your taste">
        <p>
          Your taste profile is built from the inspiration saved to your
          account. Sign in to interpret it and correct anything that&apos;s off.
        </p>
      </SignInCard>
    );
  }
  return <SignedInTaste />;
}

function SignedInTaste() {
  const { client } = useServer();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [basis, setBasis] = useState<TasteDerivationBasis | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [taste, list] = await Promise.all([
        client.taste
          .$get()
          .then((r) => readJson<{ profile: TasteProfile | null }>(r)),
        client.taste.inspiration
          .$get()
          .then((r) => readJson<{ items: InspirationItem[] }>(r)),
      ]);
      setProfile(taste.profile);
      setItemCount(list.items.length);
      setLoad({ kind: "ready" });
    } catch (e) {
      setLoad({
        kind: "error",
        message: friendlyError(e, "We couldn't load your taste profile."),
      });
    }
  }, [client]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function derive() {
    setDeriving(true);
    setDeriveError("");
    setStatus("");
    setError("");
    setEditing(false);
    try {
      const draft = readTasteDraft();
      const body: TasteDeriveRequest = {};
      const description = draft.description.trim().slice(0, 1000);
      if (description) body.description = description;
      const b = parseList(draft.brands);
      const c = parseList(draft.colours);
      if (b.length) body.preferredBrands = b;
      if (c.length) body.preferredColours = c;
      const res = await client.taste.derive.$post({ json: body });
      const out = await readJson<{
        profile: TasteProfile;
        basis: TasteDerivationBasis;
      }>(res);
      setProfile(out.profile);
      setBasis(out.basis);
      setStatus(
        "Your taste has been interpreted. Check it below and correct anything that's off.",
      );
    } catch (e) {
      setDeriveError(
        friendlyError(
          e,
          "We couldn't interpret your taste just now. Please try again.",
        ),
      );
    } finally {
      setDeriving(false);
    }
  }

  async function save(update: TasteProfileUpdate, done: string) {
    setSaving(true);
    setError("");
    try {
      const res = await client.taste.$put({ json: update });
      const { profile: next } = await readJson<{ profile: TasteProfile }>(res);
      setProfile(next);
      setStatus(done);
      return true;
    } catch (e) {
      setStatus("");
      setError(friendlyError(e, "We couldn't save that. Please try again."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (load.kind === "loading") {
    return <Checking>Loading your taste profile…</Checking>;
  }
  if (load.kind === "error") {
    return (
      <Card>
        <p role="alert" className="text-sm text-amber-200">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void loadAll()}
          className={primaryButton}
        >
          Try again
        </button>
      </Card>
    );
  }

  const interpreted = hasInterpretation(profile);
  const hasDraftText = (() => {
    const d = readTasteDraft();
    return Boolean(d.description.trim() || d.brands.trim() || d.colours.trim());
  })();

  return (
    <div className="flex flex-col gap-4">
      <AiNotice basis={basis} />

      {deriving ? (
        <DeriveProgress />
      ) : (
        !editing && (
          <Card
            title={interpreted ? undefined : "Interpret my taste"}
            labelledBy="taste-derive"
          >
            {!interpreted && (
              <p className="text-sm text-muted">
                {itemCount > 0
                  ? `We'll look at the ${itemCount} item${itemCount === 1 ? "" : "s"} you added, your reactions and notes${hasDraftText ? ", and your own words" : ""}.`
                  : hasDraftText
                    ? "You haven't added any photos yet, so we'll work from your own words only."
                    : "Add some photos, links or words first so we have something to go on."}
              </p>
            )}
            {interpreted && (
              <p className="text-sm text-muted">
                Added more inspiration? Interpret again. Anything you&apos;ve
                corrected yourself is kept.
              </p>
            )}
            <button
              type="button"
              onClick={() => void derive()}
              disabled={saving}
              className={interpreted ? secondaryButton : primaryButton}
            >
              {interpreted ? "Interpret again" : "Interpret my taste"}
            </button>
            {itemCount === 0 && !hasDraftText && (
              <Link
                href="/journey/style"
                className="min-h-11 self-start py-2 text-sm text-muted underline"
              >
                ‹ Add inspiration
              </Link>
            )}
          </Card>
        )
      )}

      {deriveError && (
        <Card>
          <p role="alert" className="text-sm text-amber-200">
            {deriveError}
          </p>
          <button
            type="button"
            onClick={() => void derive()}
            className={primaryButton}
          >
            Try again
          </button>
        </Card>
      )}

      {profile &&
        interpreted &&
        !deriving &&
        (editing ? (
          <AdjustTaste
            profile={profile}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={async (update) => {
              const ok = await save(
                update,
                "Saved. Your corrections are kept if you interpret again.",
              );
              if (ok) setEditing(false);
            }}
          />
        ) : (
          <ProfileView
            profile={profile}
            saving={saving}
            onRemove={(key) => {
              const attr = profile.attributes.find((a) => a.key === key);
              void save(
                {
                  attributes: toAttributeInputs(
                    toEditable(profile.attributes).filter((a) => a.key !== key),
                  ),
                },
                `Removed “${attr?.value ?? "attribute"}”.`,
              );
            }}
            onAccept={() =>
              void save(
                { status: "accepted" },
                "Thanks — we'll use this taste profile for your plan.",
              )
            }
            onAdjust={() => {
              setStatus("");
              setEditing(true);
            }}
          />
        ))}

      <div aria-live="polite" className="min-h-5 text-sm text-muted">
        {status}
      </div>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}

function AiNotice({ basis }: { basis: TasteDerivationBasis | null }) {
  return (
    <aside className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-inset p-4 text-sm text-muted">
      <p>
        <span className="font-semibold text-foreground">
          AI interpretation.
        </span>{" "}
        This is our AI&apos;s reading of your inspiration — a starting point,
        not a label. Keep what feels right and correct the rest.
      </p>
      {basis && <p>{basis.message}</p>}
    </aside>
  );
}

const STAGES = [
  { after: 0, text: "Looking at your images and notes…" },
  { after: 8, text: "Picking out colours, materials and shapes…" },
  { after: 20, text: "Writing your summary…" },
  { after: 40, text: "Still working — this can take up to a minute." },
];

function DeriveProgress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - t0) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  const stage = [...STAGES].reverse().find((s) => seconds >= s.after);
  return (
    <Card title="Interpreting your taste" labelledBy="taste-progress">
      <p role="status" className="text-sm">
        {stage?.text}
      </p>
      <progress
        aria-label="Interpreting your taste"
        className="h-2 w-full overflow-hidden rounded-full"
      />
      <p className="text-xs text-muted" aria-hidden="true">
        {seconds}s · usually 10–30 seconds
      </p>
    </Card>
  );
}

function ProfileView({
  profile,
  saving,
  onRemove,
  onAccept,
  onAdjust,
}: {
  profile: TasteProfile;
  saving: boolean;
  onRemove: (key: string) => void;
  onAccept: () => void;
  onAdjust: () => void;
}) {
  const { likes, avoids } = splitLikesAndAvoids(
    coreAttributes(profile.attributes),
  );
  const accepted = profile.status === "accepted";
  return (
    <>
      <Card eyebrow="Your interpreted taste" labelledBy="taste-summary">
        <p className="text-xs text-muted">{statusWording(profile.status)}</p>
        {profile.summary ? (
          <p className="font-serif text-2xl leading-snug">{profile.summary}</p>
        ) : (
          <p className="text-sm text-muted">No summary yet.</p>
        )}
      </Card>

      <AttributeGroup
        title="What you're drawn to"
        id="taste-likes"
        attrs={likes}
        tone="like"
        empty="Nothing here yet."
        saving={saving}
        onRemove={onRemove}
      />
      <AttributeGroup
        title="What you'd rather avoid"
        id="taste-avoids"
        attrs={avoids}
        tone="avoid"
        empty="No dislikes picked up. Add some if there's anything you'd rather not see."
        saving={saving}
        onRemove={onRemove}
      />

      {(profile.preferredBrands.length > 0 ||
        profile.preferredColours.length > 0) && (
        <Card title="Your stated preferences" labelledBy="taste-prefs">
          {profile.preferredBrands.length > 0 && (
            <p className="text-sm">
              <span className="text-muted">Brands: </span>
              {profile.preferredBrands.join(", ")}
            </p>
          )}
          {profile.preferredColours.length > 0 && (
            <p className="text-sm">
              <span className="text-muted">Colours: </span>
              {profile.preferredColours.join(", ")}
            </p>
          )}
          <Link
            href="/journey/style"
            className="min-h-11 self-start py-2 text-sm text-muted underline"
          >
            Change these on the Style step
          </Link>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {accepted ? (
          <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm">
            <span aria-hidden="true">✓ </span>You confirmed this looks like you.
          </p>
        ) : (
          <button
            type="button"
            onClick={onAccept}
            disabled={saving}
            className={primaryButton}
          >
            Looks like me
          </button>
        )}
        <button
          type="button"
          onClick={onAdjust}
          disabled={saving}
          className={secondaryButton}
        >
          Adjust taste
        </button>
      </div>
    </>
  );
}

function AttributeGroup({
  title,
  id,
  attrs,
  tone,
  empty,
  saving,
  onRemove,
}: {
  title: string;
  id: string;
  attrs: TasteProfile["attributes"];
  tone: "like" | "avoid";
  empty: string;
  saving: boolean;
  onRemove: (key: string) => void;
}) {
  return (
    <Card title={title} labelledBy={id}>
      {attrs.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {attrs.map((a) => {
            const conf = confidenceWording(a.confidence, a.userEdited);
            return (
              <li
                key={a.key}
                className={`flex max-w-full items-center gap-1 rounded-2xl py-1 pr-1 pl-4 ${tone === "like" ? "bg-cream text-ink" : "border border-white/20 bg-inset"}`}
              >
                <span className="flex min-w-0 flex-col py-1">
                  <span className="break-words font-medium">{a.value}</span>
                  <span
                    className={`text-xs ${tone === "like" ? "text-ink/70" : "text-muted"}`}
                  >
                    {a.label} · {conf.short}
                    <span className="sr-only">. {conf.sentence}</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(a.key)}
                  disabled={saving}
                  aria-label={`Remove ${a.value}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-lg focus-visible:outline-2 focus-visible:outline-current"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AdjustTaste({
  profile,
  saving,
  onCancel,
  onSave,
}: {
  profile: TasteProfile;
  saving: boolean;
  onCancel: () => void;
  onSave: (update: TasteProfileUpdate) => void | Promise<void>;
}) {
  const uid = useId();
  const [summary, setSummary] = useState(profile.summary);
  const [attrs, setAttrs] = useState<EditableAttribute[]>(() =>
    toEditable(profile.attributes),
  );
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState<string>("style");
  const diff = diffAttributes(profile.attributes, attrs);
  const summaryChanged = summary.trim() !== profile.summary.trim();
  const changes = diff.total + (summaryChanged ? 1 : 0);

  const change = (id: string, patch: Partial<EditableAttribute>) =>
    setAttrs((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  function add(e: React.FormEvent) {
    e.preventDefault();
    const value = newValue.trim();
    if (!value) return;
    setAttrs((list) => [
      ...list,
      {
        id: `new-${Date.now()}`,
        label: categoryLabel(newCategory),
        value: value.slice(0, 160),
      },
    ]);
    setNewValue("");
  }

  return (
    <Card
      eyebrow="Adjust taste"
      title="Keep it in your words."
      labelledBy={`${uid}-h`}
    >
      <p className="text-sm text-muted">
        Change any wording, move things between categories, remove what&apos;s
        wrong and add what we missed. Use “Avoid” for things you don&apos;t
        want.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs tracking-[0.15em] text-muted uppercase">
          Summary
        </span>
        <textarea
          rows={4}
          maxLength={1000}
          className={textInput}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>

      <ul className="flex flex-col gap-3" aria-label="Taste attributes">
        {attrs.map((a, i) => {
          const cat = categoryKeyFor(a);
          return (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-2xl bg-inset p-3"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs tracking-[0.15em] text-muted uppercase">
                  Attribute {i + 1}
                </span>
                <input
                  className={textInput}
                  maxLength={160}
                  value={a.value}
                  onChange={(e) => change(a.id, { value: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-xs tracking-[0.15em] text-muted uppercase">
                    Category
                  </span>
                  <select
                    className={`${textInput} min-h-11`}
                    value={cat || a.label}
                    onChange={(e) =>
                      change(a.id, { label: categoryLabel(e.target.value) })
                    }
                  >
                    {!cat && <option value={a.label}>{a.label}</option>}
                    {TASTE_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setAttrs((list) => list.filter((x) => x.id !== a.id))
                  }
                  aria-label={`Remove ${a.value || `attribute ${i + 1}`}`}
                  className={secondaryButton}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={add}
        className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 p-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs tracking-[0.15em] text-muted uppercase">
            Add a description
          </span>
          <input
            className={textInput}
            maxLength={160}
            placeholder="Easy-care materials"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-xs tracking-[0.15em] text-muted uppercase">
              Category
            </span>
            <select
              className={`${textInput} min-h-11`}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {TASTE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!newValue.trim()}
            className={secondaryButton}
          >
            {newValue.trim() ? `Add “${newValue.trim().slice(0, 24)}”` : "Add"}
          </button>
        </div>
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {changes === 0
          ? "No changes yet."
          : `${changes} unsaved change${changes === 1 ? "" : "s"}${diff.total ? `: ${describeDiff(diff)}` : ""}${summaryChanged ? `${diff.total ? "," : ":"} summary edited` : ""}.`}
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={saving || changes === 0}
          onClick={() =>
            void onSave({
              ...(summaryChanged ? { summary: summary.trim() } : {}),
              attributes: toAttributeInputs(attrs),
            })
          }
          className={primaryButton}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={secondaryButton}
        >
          Cancel
        </button>
      </div>
    </Card>
  );
}
