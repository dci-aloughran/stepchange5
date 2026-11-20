"use client";

import type {
  Concept,
  RoomDetail,
  TasteProfile,
  UploadDto,
} from "@stepchange/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PHOTO_ACCEPT,
  shrinkImage,
  uploadWithProgress,
} from "@/lib/plan/upload";
import { readJson, useServer } from "@/lib/server";
import {
  btnPrimary,
  btnQuiet,
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

type Tier = "practical" | "recommended" | "aspirational";
const TIERS: { value: Tier; label: string; hint: string }[] = [
  {
    value: "practical",
    label: "Practical",
    hint: "Durable, affordable, easy care",
  },
  {
    value: "recommended",
    label: "Recommended",
    hint: "Balanced quality and cost",
  },
  {
    value: "aspirational",
    label: "Aspirational",
    hint: "Statement pieces, richer finishes",
  },
];
const FALLBACK_VIBES = [
  "Calm and natural",
  "Warm modern",
  "Light Scandinavian",
  "Cosy traditional",
];
const BASIS_TEXT: Record<string, string> = {
  user_confirmed: "room size measured by you",
  source_printed: "room size printed on the floor plan",
  calculated: "room size calculated from the plan's scale",
  estimated: "estimated room size (not verified)",
  unknown: "room size unknown (proportions guessed)",
};

export function vibeSuggestions(taste: TasteProfile | null): string[] {
  const fromTaste = (taste?.attributes ?? [])
    .filter(
      (a) =>
        a.key.startsWith("style.") ||
        a.key.startsWith("mood.") ||
        a.key.startsWith("palette."),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .map((a) => a.value.slice(0, 60));
  const unique = [...new Set(fromTaste)].slice(0, 6);
  return unique.length ? unique : FALLBACK_VIBES;
}

export function ConceptSection({
  room,
  ready,
}: {
  room: RoomDetail;
  ready: boolean;
}) {
  const { client, getToken } = useServer();
  const [taste, setTaste] = useState<TasteProfile | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [photos, setPhotos] = useState<UploadDto[]>([]);
  const [vibe, setVibe] = useState("");
  const [tier, setTier] = useState<Tier>("recommended");
  const [photoId, setPhotoId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const { uploads } = await readJson<{ uploads: UploadDto[] }>(
      await client.uploads.$get({
        query: { roomId: room.id, purpose: "room_photo", status: "available" },
      }),
    );
    setPhotos(uploads);
    return uploads;
  }, [client, room.id]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const [t, c] = await Promise.all([
        readJson<{ profile: TasteProfile | null }>(await client.taste.$get())
          .then((r) => r.profile)
          .catch(() => null),
        readJson<{ concepts: Concept[] }>(
          await client.concepts.$get({ query: { roomId: room.id } }),
        )
          .then((r) => r.concepts)
          .catch(() => []),
        loadPhotos().catch(() => []),
      ]);
      if (cancelled) return;
      setTaste(t);
      setConcepts(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, room.id, ready, loadPhotos]);

  const suggestions = vibeSuggestions(taste);

  async function generate() {
    const v = vibe.trim();
    if (v.length < 2) {
      setError("Describe the vibe in a couple of words, or pick a suggestion.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Generating your concept…");
    try {
      const { concept } = await readJson<{ concept: Concept }>(
        await client.concepts.$post({
          json: {
            roomId: room.id,
            vibe: v.slice(0, 80),
            tier,
            ...(photoId ? { sourceUploadId: photoId } : {}),
          },
        }),
      );
      setConcepts((prev) => [concept, ...prev]);
      setStatus("Concept ready. It's indicative only; see the note under it.");
    } catch (e) {
      setError(errorMessage(e, "Couldn't create the concept."));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function upload(original: File) {
    setError(null);
    try {
      const file = await shrinkImage(original);
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "room_photo");
      form.set("roomId", room.id);
      setUploadPct(0);
      const { upload: u } = await uploadWithProgress(form, token, setUploadPct);
      const list = await loadPhotos();
      if (list.some((p) => p.id === u.id)) {
        setPhotoId(u.id);
        setStatus("Photo added and selected.");
      } else {
        setStatus("Photo uploaded. It will be available once it's checked.");
      }
    } catch (e) {
      setError(errorMessage(e, "Couldn't upload that photo."));
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const visible = showAll ? concepts : concepts.slice(0, 2);

  return (
    <Card
      id="concept"
      aria-labelledby="concept-heading"
      className="scroll-mt-4"
    >
      <Eyebrow>3 · Visual concept</Eyebrow>
      <h2 id="concept-heading" className="font-serif text-2xl">
        How could it feel?
      </h2>
      {!ready ? (
        <p className="text-sm text-muted">
          Styling comes after function: accept the brief and plan the layout
          first.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            An AI-generated, indicative image based on your accepted brief and
            layout. It isn't a photo of real products or a guarantee of fit.
          </p>
          <div className={fieldBox}>
            <label htmlFor="vibe" className={fieldLabel}>
              Vibe
            </label>
            <input
              id="vibe"
              className={fieldInput}
              value={vibe}
              maxLength={80}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="e.g. Calm and natural"
            />
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">
              {taste ? "Vibes from your style profile" : "Vibe ideas"}
            </legend>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={vibe === s}
                onClick={() => setVibe(s)}
                className={`min-h-11 rounded-full border px-4 text-sm ${vibe === s ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
              >
                {s}
              </button>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className={`${fieldLabel} mb-2`}>Tier</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TIERS.map((t) => (
                <label
                  key={t.value}
                  className={`flex min-h-11 cursor-pointer flex-col rounded-2xl border px-4 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cream ${tier === t.value ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t.value}
                    checked={tier === t.value}
                    onChange={() => setTier(t.value)}
                    className="sr-only"
                  />
                  <span className="font-medium">{t.label}</span>
                  <span
                    className={tier === t.value ? "text-ink/70" : "text-muted"}
                  >
                    {t.hint}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className={`${fieldLabel} mb-2`}>
              Room photo (optional)
            </legend>
            <p className="text-xs text-muted">
              With a photo the concept looks more like your room. Without one,
              it's generated from the room's description.
            </p>
            <div className="flex flex-wrap gap-2">
              <PhotoChoice
                id=""
                label="No photo"
                selected={photoId === ""}
                onSelect={() => setPhotoId("")}
              />
              {photos.map((p, i) => (
                <PhotoChoice
                  key={p.id}
                  id={p.id}
                  label={`Photo ${i + 1}`}
                  selected={photoId === p.id}
                  onSelect={() => setPhotoId(p.id)}
                />
              ))}
            </div>
            <label
              className={`${btnQuiet} cursor-pointer ${uploadPct !== null ? "pointer-events-none opacity-50" : ""}`}
            >
              {uploadPct !== null
                ? `Uploading… ${uploadPct}%`
                : "Add a photo of this room"}
              <input
                ref={fileRef}
                type="file"
                accept={PHOTO_ACCEPT}
                className="sr-only"
                disabled={uploadPct !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </label>
          </fieldset>

          <button
            type="button"
            className={btnPrimary}
            disabled={busy || uploadPct !== null}
            onClick={() => void generate()}
          >
            {busy ? "Generating…" : "Generate concept"}
          </button>
          <div aria-live="polite" className="flex flex-col gap-2 text-sm">
            {busy && (
              <Working
                label="Generating an image of your room…"
                expected="This can take up to a minute."
              />
            )}
            {status && !busy && <p className="text-muted">{status}</p>}
          </div>
          {error && (
            <Notice tone="bad" role="alert">
              <p>{error}</p>
            </Notice>
          )}

          {visible.length > 0 && (
            <ul className="flex flex-col gap-4" aria-label="Your concepts">
              {visible.map((c) => (
                <li key={c.id}>
                  <ConceptCard
                    concept={c}
                    roomName={room.name}
                    onChange={(next) =>
                      setConcepts((prev) =>
                        prev.map((x) => (x.id === next.id ? next : x)),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {concepts.length > 2 && (
            <button
              type="button"
              className={btnQuiet}
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll ? "Show fewer" : `Show all ${concepts.length} concepts`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function PhotoChoice({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { client } = useServer();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    client.uploads[":id"].url
      .$get({ param: { id } })
      .then((r) => readJson<{ url: string }>(r))
      .then((r) => !cancelled && setUrl(r.url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, id]);
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-2 py-1 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cream ${selected ? "border-cream bg-cream/10" : "border-white/15"}`}
    >
      <input
        type="radio"
        name="room-photo"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      {url && (
        // biome-ignore lint/performance/noImgElement: short-lived presigned URL from our own blob store
        <img src={url} alt="" className="size-10 rounded-lg object-cover" />
      )}
      <span className="px-1">
        {selected ? "✓ " : ""}
        {label}
      </span>
    </label>
  );
}

function ConceptCard({
  concept,
  roomName,
  onChange,
}: {
  concept: Concept;
  roomName: string;
  onChange: (c: Concept) => void;
}) {
  const { client } = useServer();
  const [url, setUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!concept.hasImage) return;
    let cancelled = false;
    client.concepts[":id"].url
      .$get({ param: { id: concept.id } })
      .then((r) => readJson<{ url: string }>(r))
      .then((r) => !cancelled && setUrl(r.url))
      .catch(() => !cancelled && setImgError(true));
    return () => {
      cancelled = true;
    };
  }, [client, concept.id, concept.hasImage]);

  async function rate(value: boolean) {
    setSaving(true);
    setError(null);
    try {
      const { concept: next } = await readJson<{ concept: Concept }>(
        await client.concepts[":id"].$patch({
          param: { id: concept.id },
          json: { looksLikeMyRoom: value },
        }),
      );
      onChange(next);
    } catch (e) {
      setError(errorMessage(e, "Couldn't save your rating."));
    } finally {
      setSaving(false);
    }
  }

  const tierLabel = TIERS.find((t) => t.value === concept.tier)?.label;
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl bg-inset p-3"
      data-testid="concept-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="info">AI-generated</Pill>
        <span className="text-sm">
          {concept.vibe} · {tierLabel}
        </span>
      </div>
      {url && !imgError ? (
        // biome-ignore lint/performance/noImgElement: short-lived presigned URL from our private blob store
        <img
          src={url}
          alt={`AI-generated indicative concept of ${roomName}: ${concept.vibe}, ${tierLabel} tier`}
          className="w-full rounded-xl"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-white/5 text-sm text-muted">
          {imgError ? "Image couldn't be loaded." : "Loading image…"}
        </div>
      )}
      <p className="text-xs text-muted" data-testid="concept-disclosure">
        {concept.disclosure}
      </p>
      <p className="text-xs">
        <span className="text-muted">Dimension basis: </span>
        {BASIS_TEXT[concept.dimensionBasis] ?? concept.dimensionBasis}
        {concept.sourcePhotoUsed ? " · from your photo" : " · no photo used"}
      </p>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-2 text-sm">Looks like my room?</legend>
        {[
          { v: true, label: "Yes" },
          { v: false, label: "No" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={saving}
            aria-pressed={concept.looksLikeMyRoom === o.v}
            onClick={() => void rate(o.v)}
            className={`min-h-11 min-w-16 rounded-full border px-4 text-sm ${concept.looksLikeMyRoom === o.v ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
          >
            {o.label}
          </button>
        ))}
        <span aria-live="polite" className="text-xs text-muted">
          {concept.looksLikeMyRoom != null && !saving
            ? "Thanks — rating saved."
            : ""}
        </span>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
    </article>
  );
}
