"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import type { CurrentHome } from "@/lib/plan/use-home";

export const btnPrimary =
  "inline-flex min-h-12 items-center justify-center rounded-2xl bg-cream px-5 font-semibold text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-50";
export const btnSecondary =
  "inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/15 px-4 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-50";
export const btnQuiet =
  "inline-flex min-h-11 items-center justify-center rounded-2xl bg-white/5 px-4 text-sm text-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-50";
export const fieldBox = "flex flex-col gap-1 rounded-2xl bg-inset p-3";
export const fieldLabel = "text-xs tracking-[0.15em] text-muted uppercase";
export const fieldInput =
  "min-h-9 bg-transparent text-base outline-none placeholder:text-white/35 focus-visible:outline-2 focus-visible:outline-cream rounded";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs tracking-[0.2em] text-muted uppercase">{children}</p>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-3xl border border-white/10 bg-card p-5 ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

const TONES = {
  ok: "bg-accent/15 text-accent border-accent/40",
  warn: "bg-amber-300/10 text-amber-200 border-amber-200/40",
  bad: "bg-red-400/10 text-red-200 border-red-300/50",
  none: "bg-white/5 text-muted border-white/15",
  info: "bg-sky-300/10 text-sky-200 border-sky-200/40",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = "warn",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={`rounded-2xl border px-4 py-3 text-sm ${TONES[tone]}`}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

// Elapsed-time progress for slow AI calls.
export function Working({
  label,
  expected,
}: {
  label: string;
  expected: string;
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm">
      <p>
        {label} <span className="text-muted">({secs}s)</span>
      </p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        aria-hidden="true"
      >
        <div className="h-full w-1/3 animate-pulse rounded-full bg-cream/70" />
      </div>
      <p className="text-xs text-muted">{expected}</p>
    </div>
  );
}

export function errorMessage(e: unknown, fallback = "Something went wrong.") {
  return e instanceof Error && e.message ? e.message : fallback;
}

// Page frame + home resolution states shared by every plan page.
export function PlanFrame({
  home,
  eyebrow,
  title,
  intro,
  back,
  children,
}: {
  home: CurrentHome;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  back?: { href: string; label: string };
  children: (homeId: string) => ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-10 md:max-w-2xl">
      <Brand trailing="Plan" />
      {back && (
        <Link
          href={back.href}
          className="-mb-3 inline-flex min-h-11 items-center self-start text-sm text-muted"
        >
          ‹ {back.label}
        </Link>
      )}
      <header className="flex flex-col gap-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-serif text-4xl leading-tight">{title}</h1>
        {intro && <div className="text-muted">{intro}</div>}
      </header>
      {home.kind === "loading" && (
        <p role="status" className="text-muted">
          Loading your plan…
        </p>
      )}
      {home.kind === "signed_out" && (
        <Card>
          <h2 className="font-serif text-2xl">Sign in to see your plan</h2>
          <p className="text-sm text-muted">
            Your rooms, briefs and budget are saved to your account.
          </p>
          <SignInButton mode="modal">
            <button type="button" className={btnPrimary}>
              Sign in
            </button>
          </SignInButton>
        </Card>
      )}
      {home.kind === "no_home" && (
        <Card>
          <h2 className="font-serif text-2xl">No home yet</h2>
          <p className="text-sm text-muted">
            Tell us about your home and its rooms first, then come back to build
            the plan.
          </p>
          <Link href="/journey/home" className={btnPrimary}>
            Start with your home
          </Link>
        </Card>
      )}
      {home.kind === "error" && (
        <Notice tone="bad" role="alert" title="Couldn't load your plan">
          <p>{home.message}</p>
        </Notice>
      )}
      {home.kind === "ready" && children(home.homeId)}
    </main>
  );
}
