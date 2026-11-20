"use client";

import { SignInButton } from "@clerk/nextjs";
import type { ReactNode } from "react";

export const primaryButton =
  "min-h-12 rounded-2xl bg-cream px-5 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-50";
export const secondaryButton =
  "min-h-11 rounded-2xl border border-white/15 px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-50";
export const textInput =
  "w-full rounded-xl border border-white/10 bg-inset px-3 py-2.5 text-base outline-none placeholder:text-white/35 focus-visible:border-cream";

export function Card({
  eyebrow,
  title,
  children,
  labelledBy,
}: {
  eyebrow?: string;
  title?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={title ? labelledBy : undefined}
      className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-card p-5"
    >
      {eyebrow && (
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          {eyebrow}
        </p>
      )}
      {title && (
        <h2 id={labelledBy} className="font-serif text-2xl">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function SignInCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} labelledBy="taste-sign-in">
      <div className="flex flex-col gap-2 text-sm text-muted">{children}</div>
      <SignInButton mode="modal">
        <button type="button" className={primaryButton}>
          Sign in to continue
        </button>
      </SignInButton>
    </Card>
  );
}

export function Checking({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="min-h-12 rounded-2xl bg-white/5 px-4 py-3 text-sm text-muted"
    >
      {children}
    </p>
  );
}
