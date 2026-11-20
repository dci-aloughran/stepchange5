"use client";

// Owned by the taste work (design screens 07/08): inspiration uploads, links
// and love/don't-love reactions, saved to the server (FR-07, D-003, SE-001).
import type {
  InspirationItem,
  InspirationReaction,
  TasteProfile,
} from "@stepchange/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson, useServer } from "@/lib/server";
import { readTasteDraft, writeTasteDraft } from "@/lib/taste/draft";
import {
  displayUrl,
  friendlyError,
  linkKindLabel,
  normaliseLink,
  parseList,
  sameList,
} from "@/lib/taste/taste";
import {
  INSPIRATION_ACCEPT,
  prepareImage,
  uploadInspiration,
} from "@/lib/taste/upload";
import {
  Card,
  Checking,
  primaryButton,
  SignInCard,
  secondaryButton,
  textInput,
} from "./shared";

type Pending = {
  id: string;
  name: string;
  state: "preparing" | "uploading" | "saving" | "error";
  pct: number;
  error?: string;
};

type Load =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const MAX_DERIVE_IMAGES = 10;

export function InspirationStep() {
  const { isLoaded, isSignedIn } = useServer();
  if (!isLoaded) return <Checking>Checking sign-in…</Checking>;
  if (!isSignedIn) {
    return (
      <SignInCard title="Sign in to add inspiration">
        <p>
          Photos and screenshots are private to your account, so you need to
          sign in before uploading. It takes a moment, and you can delete your
          uploads at any time.
        </p>
        <p>
          We use your inspiration to suggest a taste profile you can correct —
          it never overrides your room sizes or accessibility needs.
        </p>
      </SignInCard>
    );
  }
  return <SignedInInspiration />;
}

function SignedInInspiration() {
  const { client, getToken } = useServer();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | "error">>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [linkError, setLinkError] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [description, setDescription] = useState("");
  const [brands, setBrands] = useState("");
  const [colours, setColours] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thumbRetried = useRef(new Set<string>());

  const say = (msg: string) => {
    setError("");
    setStatus(msg);
  };
  const fail = (e: unknown, fallback: string) => {
    setStatus("");
    setError(friendlyError(e, fallback));
  };
  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const fetchThumb = useCallback(
    async (uploadId: string) => {
      try {
        const res = await client.uploads[":id"].url.$get({
          param: { id: uploadId },
        });
        const { url } = await readJson<{ url: string }>(res);
        setThumbs((t) => ({ ...t, [uploadId]: url }));
      } catch {
        setThumbs((t) => ({ ...t, [uploadId]: "error" }));
      }
    },
    [client],
  );

  const loadAll = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [list, taste] = await Promise.all([
        client.taste.inspiration
          .$get()
          .then((r) => readJson<{ items: InspirationItem[] }>(r)),
        client.taste
          .$get()
          .then((r) => readJson<{ profile: TasteProfile | null }>(r)),
      ]);
      setItems(list.items);
      setNotes(Object.fromEntries(list.items.map((i) => [i.id, i.note ?? ""])));
      setProfile(taste.profile);
      const draft = readTasteDraft();
      setDescription(draft.description);
      if (taste.profile) {
        // Once a profile exists, it holds the stated preferences.
        const b = taste.profile.preferredBrands.join(", ");
        const c = taste.profile.preferredColours.join(", ");
        setBrands(b);
        setColours(c);
        writeTasteDraft({ brands: b, colours: c });
      } else {
        setBrands(draft.brands);
        setColours(draft.colours);
      }
      setLoad({ kind: "ready" });
      for (const i of list.items) if (i.uploadId) void fetchThumb(i.uploadId);
    } catch (e) {
      setLoad({
        kind: "error",
        message: friendlyError(e, "We couldn't load your inspiration."),
      });
    }
  }, [client, fetchThumb]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ---- Photos ----

  async function addFiles(files: File[]) {
    const queue = files.map((f) => ({
      file: f,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
    setPending((p) => [
      ...p.filter((x) => x.state !== "error"),
      ...queue.map((q) => ({
        id: q.id,
        name: q.file.name || "Photo",
        state: "preparing" as const,
        pct: 0,
      })),
    ]);
    const patch = (id: string, change: Partial<Pending>) =>
      setPending((p) => p.map((x) => (x.id === id ? { ...x, ...change } : x)));
    let added = 0;
    for (const q of queue) {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const file = await prepareImage(q.file);
        const token = await getToken();
        if (!token) throw new Error("Please sign in again.");
        patch(q.id, { state: "uploading", pct: 0 });
        const upload = await uploadInspiration(
          file,
          token,
          (pct) => patch(q.id, { pct }),
          controller.signal,
        );
        patch(q.id, { state: "saving", pct: 100 });
        const res = await client.taste.inspiration.$post({
          json: { uploadId: upload.id, reaction: "neutral" },
        });
        const { item } = await readJson<{ item: InspirationItem }>(res);
        setItems((list) => [item, ...list]);
        setNotes((n) => ({ ...n, [item.id]: "" }));
        setPending((p) => p.filter((x) => x.id !== q.id));
        void fetchThumb(upload.id);
        added++;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setPending((p) => p.filter((x) => x.id !== q.id));
          continue;
        }
        patch(q.id, {
          state: "error",
          error: friendlyError(
            e,
            "We couldn't add this photo. Please try again.",
          ),
        });
      }
    }
    abortRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    if (added) {
      say(
        `Added ${added} photo${added === 1 ? "" : "s"}. Mark each one Love or Don't love.`,
      );
    }
  }

  // ---- Links (stored as references only, D-003) ----

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    const parsed = normaliseLink(link);
    if (!parsed) {
      setLinkError("Enter a web link, for example https://pinterest.com/…");
      return;
    }
    setLinkError("");
    setAddingLink(true);
    try {
      const note = linkNote.trim();
      const res = await client.taste.inspiration.$post({
        json: {
          sourceUrl: parsed.url,
          reaction: "love",
          ...(note ? { note: note.slice(0, 500) } : {}),
        },
      });
      const { item } = await readJson<{ item: InspirationItem }>(res);
      setItems((list) => [item, ...list]);
      setNotes((n) => ({ ...n, [item.id]: item.note ?? "" }));
      setLink("");
      setLinkNote("");
      say(`Saved your ${linkKindLabel(item.kind)} link as a reference.`);
    } catch (err) {
      setLinkError(friendlyError(err, "We couldn't save that link."));
    } finally {
      setAddingLink(false);
    }
  }

  // ---- Item edits ----

  async function react(item: InspirationItem, reaction: InspirationReaction) {
    const next: InspirationReaction =
      item.reaction === reaction ? "neutral" : reaction;
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, reaction: next } : i)),
    );
    setBusy(item.id, true);
    try {
      const res = await client.taste.inspiration[":id"].$patch({
        param: { id: item.id },
        json: { reaction: next },
      });
      await readJson(res);
      say(
        next === "love"
          ? "Marked as Love."
          : next === "dislike"
            ? "Marked as Don't love."
            : "Reaction cleared.",
      );
    } catch (e) {
      setItems((list) =>
        list.map((i) =>
          i.id === item.id ? { ...i, reaction: item.reaction } : i,
        ),
      );
      fail(e, "We couldn't save that. Please try again.");
    } finally {
      setBusy(item.id, false);
    }
  }

  async function saveNote(item: InspirationItem) {
    const value = (notes[item.id] ?? "").trim().slice(0, 500);
    if (value === (item.note ?? "")) return;
    try {
      const res = await client.taste.inspiration[":id"].$patch({
        param: { id: item.id },
        json: { note: value || null },
      });
      await readJson(res);
      setItems((list) =>
        list.map((i) => (i.id === item.id ? { ...i, note: value || null } : i)),
      );
      say("Note saved.");
    } catch (e) {
      fail(e, "We couldn't save your note. Please try again.");
    }
  }

  async function remove(item: InspirationItem) {
    setBusy(item.id, true);
    try {
      if (item.uploadId) {
        // Deleting the upload removes the stored image and, with it, the
        // inspiration item.
        const res = await client.uploads[":id"].$delete({
          param: { id: item.uploadId },
        });
        if (res.status !== 404) await readJson(res);
        if (res.status === 404) {
          await readJson(
            await client.taste.inspiration[":id"].$delete({
              param: { id: item.id },
            }),
          );
        }
      } else {
        await readJson(
          await client.taste.inspiration[":id"].$delete({
            param: { id: item.id },
          }),
        );
      }
      setItems((list) => list.filter((i) => i.id !== item.id));
      say(item.uploadId ? "Photo removed and deleted." : "Link removed.");
    } catch (e) {
      fail(e, "We couldn't remove that. Please try again.");
    } finally {
      setBusy(item.id, false);
    }
  }

  // ---- Free text ----

  async function savePreferences() {
    const b = parseList(brands);
    const c = parseList(colours);
    writeTasteDraft({ brands: b.join(", "), colours: c.join(", ") });
    if (!profile) return;
    if (
      sameList(b, profile.preferredBrands) &&
      sameList(c, profile.preferredColours)
    ) {
      return;
    }
    try {
      const res = await client.taste.$put({
        json: { preferredBrands: b, preferredColours: c },
      });
      const { profile: next } = await readJson<{ profile: TasteProfile }>(res);
      setProfile(next);
      say("Preferences saved to your taste profile.");
    } catch (e) {
      fail(e, "We couldn't save your preferences. Please try again.");
    }
  }

  if (load.kind === "loading") {
    return <Checking>Loading your inspiration…</Checking>;
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

  const uploading = pending.some((p) => p.state !== "error");
  const images = items.filter((i) => i.uploadId);
  const loved = items.filter((i) => i.reaction === "love").length;
  const disliked = items.filter((i) => i.reaction === "dislike").length;

  return (
    <div className="flex flex-col gap-4">
      <Card eyebrow="01" title="Photos & screenshots" labelledBy="insp-photos">
        <p className="text-sm text-muted">
          Rooms you love, saved posts, products — screenshots work well. PNG,
          JPEG or WebP; large photos are shrunk on your phone before upload.
          Location data is removed.
        </p>
        <label
          className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-cream px-4 text-center font-semibold text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cream ${uploading ? "pointer-events-none opacity-50" : ""}`}
        >
          {images.length ? "Add more photos" : "Add photos or screenshots"}
          <input
            ref={inputRef}
            type="file"
            accept={INSPIRATION_ACCEPT}
            multiple
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) void addFiles(files);
            }}
          />
        </label>
        {pending.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Uploads in progress">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-2xl bg-inset p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  {p.state === "error" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPending((list) => list.filter((x) => x.id !== p.id))
                      }
                      className="min-h-11 shrink-0 rounded-xl px-3 text-muted underline"
                    >
                      Dismiss
                    </button>
                  ) : p.state === "uploading" ? (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="min-h-11 shrink-0 rounded-xl px-3 text-muted underline"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                {p.state === "error" ? (
                  <p role="alert" className="text-amber-200">
                    {p.error}
                  </p>
                ) : (
                  <>
                    <p className="text-muted">
                      {p.state === "preparing"
                        ? "Getting ready…"
                        : p.state === "uploading"
                          ? `Uploading… ${p.pct}%`
                          : "Checking and saving…"}
                    </p>
                    <progress
                      value={p.state === "preparing" ? undefined : p.pct}
                      max={100}
                      aria-label={`Upload progress for ${p.name}`}
                      className="h-2 w-full overflow-hidden rounded-full"
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        eyebrow="02"
        title="Pinterest & Instagram links"
        labelledBy="insp-links"
      >
        <p className="text-sm text-muted">
          Paste a board, pin or post link. We save it as a reference only — we
          don&apos;t open it, fetch it or connect to your account, so the AI
          can&apos;t see what&apos;s on it. Add a note saying what you like, or
          upload screenshots above.
        </p>
        <form onSubmit={addLink} className="flex flex-col gap-3" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs tracking-[0.15em] text-muted uppercase">
              Board or post link
            </span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              className={textInput}
              placeholder="pinterest.com/…/our-first-place"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? "insp-link-error" : undefined}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs tracking-[0.15em] text-muted uppercase">
              What you like about it (optional)
            </span>
            <input
              className={textInput}
              placeholder="Calm bedrooms, lots of linen and oak"
              maxLength={500}
              value={linkNote}
              onChange={(e) => setLinkNote(e.target.value)}
            />
          </label>
          {linkError && (
            <p
              id="insp-link-error"
              role="alert"
              className="text-sm text-amber-200"
            >
              {linkError}
            </p>
          )}
          <button
            type="submit"
            disabled={addingLink || !link.trim()}
            className={secondaryButton}
          >
            {addingLink ? "Saving…" : "Save link"}
          </button>
        </form>
      </Card>

      <Card
        eyebrow={`Your inspiration · ${items.length}`}
        title="Love it, or don't?"
        labelledBy="insp-items"
      >
        {items.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing added yet. Add a few photos or links above, then mark each
            one — there are no wrong answers.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {loved} loved · {disliked} not loved
              {images.length > MAX_DERIVE_IMAGES
                ? ` · We look at up to ${MAX_DERIVE_IMAGES} photos, starting with ones you've marked.`
                : ""}
            </p>
            <ul className="flex flex-col gap-4">
              {items.map((item, idx) => (
                <InspirationCard
                  key={item.id}
                  item={item}
                  // Numbered oldest-first within photos or links (the list
                  // is newest-first), so names stay stable as items are added.
                  index={
                    items
                      .slice(idx + 1)
                      .filter(
                        (i) => Boolean(i.uploadId) === Boolean(item.uploadId),
                      ).length
                  }
                  thumb={item.uploadId ? thumbs[item.uploadId] : undefined}
                  onThumbError={() => {
                    if (!item.uploadId) return;
                    if (thumbRetried.current.has(item.uploadId)) {
                      setThumbs((t) => ({
                        ...t,
                        [item.uploadId as string]: "error",
                      }));
                      return;
                    }
                    // Viewing links expire after a few minutes; get a new one.
                    thumbRetried.current.add(item.uploadId);
                    void fetchThumb(item.uploadId);
                  }}
                  note={notes[item.id] ?? ""}
                  onNote={(v) => setNotes((n) => ({ ...n, [item.id]: v }))}
                  onNoteBlur={() => void saveNote(item)}
                  onReact={(r) => void react(item, r)}
                  onRemove={() => void remove(item)}
                  busy={busyIds.has(item.id)}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card eyebrow="03" title="In your words" labelledBy="insp-words">
        <p className="text-sm text-muted">
          Optional. Words, brands and colours help when photos don&apos;t say it
          all.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs tracking-[0.15em] text-muted uppercase">
            Words that describe what you like
          </span>
          <textarea
            rows={3}
            maxLength={1000}
            className={textInput}
            placeholder="Warm, calm, natural wood, nothing too shiny"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              writeTasteDraft({ description: description.trim() });
              say(
                "Saved on this device. We'll use it when we interpret your taste.",
              );
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs tracking-[0.15em] text-muted uppercase">
            Brands you like
          </span>
          <input
            className={textInput}
            placeholder="HAY, John Lewis, Habitat"
            value={brands}
            onChange={(e) => setBrands(e.target.value)}
            onBlur={() => void savePreferences()}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs tracking-[0.15em] text-muted uppercase">
            Colours you like
          </span>
          <input
            className={textInput}
            placeholder="Sage green, warm white, terracotta"
            value={colours}
            onChange={(e) => setColours(e.target.value)}
            onBlur={() => void savePreferences()}
          />
        </label>
        <p className="text-xs text-muted">
          Separate with commas.{" "}
          {profile
            ? "Brands and colours are saved to your taste profile."
            : "These are kept on this device until we interpret your taste, then saved to your profile."}
        </p>
      </Card>

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

function InspirationCard({
  item,
  index,
  thumb,
  onThumbError,
  note,
  onNote,
  onNoteBlur,
  onReact,
  onRemove,
  busy,
}: {
  item: InspirationItem;
  index: number;
  thumb: string | "error" | undefined;
  onThumbError: () => void;
  note: string;
  onNote: (v: string) => void;
  onNoteBlur: () => void;
  onReact: (r: InspirationReaction) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const name = item.uploadId
    ? `Photo ${index + 1}`
    : `${item.kind === "link" ? "Link" : `${linkKindLabel(item.kind)} link`} ${index + 1}`;
  const noteId = `insp-note-${item.id}`;
  return (
    <li
      aria-label={name}
      className="flex flex-col gap-3 rounded-2xl bg-inset p-3"
    >
      {item.uploadId ? (
        <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-white/5 text-sm text-muted">
          {thumb && thumb !== "error" ? (
            // biome-ignore lint/performance/noImgElement: short-lived presigned URL; next/image can't optimise it
            <img
              src={thumb}
              alt={
                item.note
                  ? `Inspiration: ${item.note}`
                  : `Your inspiration, ${name}`
              }
              className="h-full w-full object-cover"
              onError={onThumbError}
            />
          ) : thumb === "error" ? (
            <span>Preview unavailable</span>
          ) : (
            <span>Loading preview…</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-xl border border-white/10 p-3">
          <span className="text-xs tracking-[0.15em] text-muted uppercase">
            {linkKindLabel(item.kind)} · reference only
          </span>
          <span className="break-all">{displayUrl(item.sourceUrl ?? "")}</span>
        </div>
      )}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">How do you feel about {name}?</legend>
        <button
          type="button"
          aria-pressed={item.reaction === "dislike"}
          disabled={busy}
          onClick={() => onReact("dislike")}
          className={`min-h-11 rounded-2xl border text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream ${item.reaction === "dislike" ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
        >
          <span aria-hidden="true">× </span>Don&apos;t love
        </button>
        <button
          type="button"
          aria-pressed={item.reaction === "love"}
          disabled={busy}
          onClick={() => onReact("love")}
          className={`min-h-11 rounded-2xl border text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream ${item.reaction === "love" ? "border-transparent bg-cream text-ink" : "border-white/15"}`}
        >
          <span aria-hidden="true">♡ </span>Love
        </button>
      </fieldset>
      <label htmlFor={noteId} className="flex flex-col gap-1 text-sm">
        <span className="text-xs tracking-[0.15em] text-muted uppercase">
          Note (optional)
        </span>
        <input
          id={noteId}
          className={textInput}
          maxLength={500}
          placeholder={
            item.uploadId
              ? "Love the sofa colour"
              : "What do you like about it?"
          }
          value={note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={onNoteBlur}
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="min-h-11 self-start rounded-xl px-2 text-sm text-muted underline focus-visible:outline-2 focus-visible:outline-cream"
      >
        Remove {name}
      </button>
    </li>
  );
}
