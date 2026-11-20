"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import type { UserProfile } from "@stepchange/shared";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { readJson, useServer } from "@/lib/server";
import {
  clearLocalJourneyData,
  DELETE_CONFIRM_WORD,
  filenameFromDisposition,
  isDeleteConfirmed,
  RETENTION_NOTICE,
} from "./account-logic";

const card = "rounded-3xl border border-white/10 bg-card p-5";
const primaryButton =
  "flex min-h-14 w-full items-center justify-center rounded-3xl bg-cream px-5 text-lg font-semibold text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const secondaryButton =
  "flex min-h-12 w-full items-center justify-center rounded-3xl border border-white/20 px-5 font-medium outline-offset-2 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

const message = (err: unknown) =>
  err instanceof Error
    ? err.message
    : "Something went wrong. Please try again.";

export function AccountView() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return (
      <p role="status" className="text-muted">
        Loading your account…
      </p>
    );
  }
  if (!isSignedIn) {
    return (
      <section className={`${card} flex flex-col gap-4`}>
        <h2 className="font-serif text-2xl">Sign in to see your account</h2>
        <p className="text-muted">
          Your account is where you resume your plan, download your data and
          manage your privacy choices.
        </p>
        <Link href="/sign-in?redirect_url=%2Faccount" className={primaryButton}>
          Sign in
        </Link>
      </section>
    );
  }
  return (
    <SignedInAccount email={user.primaryEmailAddress?.emailAddress ?? null} />
  );
}

function SignedInAccount({ email }: { email: string | null }) {
  const { client } = useServer();
  const { signOut } = useClerk();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProfile(await readJson<UserProfile>(await client.profile.me.$get()));
    } catch (err) {
      setLoadError(message(err));
    }
  }, [client]);
  useEffect(() => {
    load();
  }, [load]);

  const [signingOut, setSigningOut] = useState(false);
  const leave = async () => {
    clearLocalJourneyData(window.localStorage);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.assign("/");
    }
  };

  return (
    <>
      <section className={`${card} flex flex-col gap-4`}>
        <div>
          <p className="text-xs tracking-[0.2em] text-muted uppercase">
            Signed in as
          </p>
          <p className="mt-1 text-lg font-medium break-all">
            {email ?? "your account"}
          </p>
        </div>
        <Link href="/journey/review" className={primaryButton}>
          Resume my plan
        </Link>
      </section>

      <section aria-labelledby="privacy-heading" className={card}>
        <h2 id="privacy-heading" className="font-serif text-2xl">
          Your privacy
        </h2>
        {loadError ? (
          <div role="alert" className="mt-4 flex flex-col gap-3 text-sm">
            <p>We couldn't load your privacy settings: {loadError}</p>
            <button type="button" onClick={load} className={secondaryButton}>
              Try again
            </button>
          </div>
        ) : (
          <ConsentToggle profile={profile} onSaved={setProfile} />
        )}
        <hr className="my-5 border-white/10" />
        <DownloadData />
      </section>

      <section aria-labelledby="retention-heading" className={card}>
        <h2 id="retention-heading" className="font-serif text-2xl">
          How long we keep your data
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          {RETENTION_NOTICE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <DeleteAccount onDeleted={leave} />

      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          leave();
        }}
        className={secondaryButton}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      <p className="-mt-3 text-center text-xs text-muted">
        Signing out also clears journey progress saved in this browser.
      </p>
    </>
  );
}

// SE-010: separate, revocable consent; default off.
function ConsentToggle({
  profile,
  onSaved,
}: {
  profile: UserProfile | null;
  onSaved: (p: UserProfile) => void;
}) {
  const { client } = useServer();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const on = profile?.aiTrainingConsent ?? false;

  const toggle = async () => {
    if (!profile || saving) return;
    const next = !on;
    setSaving(true);
    setError("");
    setStatus("Saving…");
    try {
      const updated = await readJson<UserProfile>(
        await client.profile.me.$patch({ json: { aiTrainingConsent: next } }),
      );
      onSaved(updated);
      setStatus(
        updated.aiTrainingConsent
          ? "Saved. Your data may be used to improve our AI. You can turn this off at any time."
          : "Saved. Your data won't be used to train our AI.",
      );
    } catch (err) {
      setStatus("");
      setError(`Couldn't save your choice: ${message(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p id={`${id}-label`} className="font-medium">
          Help improve our AI
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-desc`}
          disabled={!profile || saving}
          onClick={toggle}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        >
          <span aria-hidden className="w-7 text-right text-sm text-muted">
            {on ? "On" : "Off"}
          </span>
          <span
            className={`relative inline-flex h-8 w-14 items-center rounded-full border transition-colors ${on ? "border-accent bg-accent" : "border-white/30 bg-inset"}`}
          >
            <span
              className={`absolute size-6 rounded-full transition-transform ${on ? "translate-x-7 bg-ink" : "translate-x-1 bg-cream"}`}
            />
          </span>
        </button>
      </div>
      <p id={`${id}-desc`} className="text-sm text-muted">
        Allow us to use your plans and choices to help train and improve our AI
        features. This is optional and separate from using the app: everything
        works the same either way. It stays off unless you turn it on, and you
        can turn it off again at any time.
      </p>
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-[#ff8a80]">
          {error}
        </p>
      )}
    </div>
  );
}

// SE-008: everything we hold, as one JSON file.
function DownloadData() {
  const { client } = useServer();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const download = async () => {
    setBusy(true);
    setError("");
    setStatus("Preparing your data…");
    try {
      const res = await client.profile.export.$get();
      if (!res.ok) await readJson(res);
      const blob = new Blob([await res.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(
        res.headers.get("content-disposition"),
      );
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus("Your data has been downloaded as a JSON file.");
    } catch (err) {
      setStatus("");
      setError(`Couldn't download your data: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-medium">Download my data</p>
        <p className="mt-1 text-sm text-muted">
          A copy of everything we hold about you (your household, homes, rooms,
          preferences and plans) as a JSON file.
        </p>
      </div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={secondaryButton}
      >
        {busy ? "Preparing…" : "Download my data"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-[#ff8a80]">
          {error}
        </p>
      )}
    </div>
  );
}

// SE-008: delete everything, with an explicit typed confirmation.
function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const { client } = useServer();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const cancel = () => {
    setOpen(false);
    setTyped("");
    setError("");
    requestAnimationFrame(() => opener.current?.focus());
  };

  const confirm = async () => {
    if (!isDeleteConfirmed(typed) || busy) return;
    setBusy(true);
    setError("");
    setStatus("Deleting your account and data…");
    try {
      const res = await client.profile.$delete();
      if (!res.ok) await readJson(res);
      setStatus("Your account and data have been deleted. Signing you out…");
      await onDeleted();
    } catch (err) {
      setStatus("");
      setError(`We couldn't delete your account: ${message(err)}`);
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-3xl border border-[#ff8a80]/40 bg-card p-5"
    >
      <h2 id={`${id}-heading`} className="font-serif text-2xl">
        Delete my account and data
      </h2>
      <p className="mt-2 text-sm text-muted">
        This permanently deletes your account, household details, homes, rooms,
        uploaded floor plans and photos, preferences and plans. It can't be
        undone. You may want to download your data first.
      </p>
      {!open ? (
        <button
          ref={opener}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-3xl border border-[#ff8a80]/60 px-5 font-medium text-[#ff8a80] outline-offset-2 hover:bg-[#ff8a80]/10 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Delete my account and data
        </button>
      ) : (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <label htmlFor={`${id}-confirm`} className="text-sm font-medium">
            Type {DELETE_CONFIRM_WORD} to confirm
          </label>
          <input
            ref={input}
            id={`${id}-confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            className="min-h-12 rounded-2xl border border-white/20 bg-inset px-4 text-base outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={!isDeleteConfirmed(typed) || busy}
            className="flex min-h-12 w-full items-center justify-center rounded-3xl bg-[#ff8a80] px-5 font-semibold text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {busy ? "Deleting…" : "Permanently delete everything"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className={secondaryButton}
          >
            Cancel
          </button>
        </form>
      )}
      <p role="status" aria-live="polite" className="mt-3 text-sm">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-[#ff8a80]">
          {error}
        </p>
      )}
    </section>
  );
}
