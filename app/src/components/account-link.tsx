"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { accountInitial } from "./account/account-logic";

// Header account control: an initial that links to /account when signed in,
// a quiet "Sign in" link otherwise. Fixed 44px so the header never jumps.
export function AccountLink() {
  const { isLoaded, isSignedIn, user } = useUser();
  const pathname = usePathname();

  if (!isLoaded) return <span aria-hidden className="block size-11" />;

  if (isSignedIn) {
    const email = user.primaryEmailAddress?.emailAddress ?? null;
    const current = pathname === "/account";
    return (
      <Link
        href="/account"
        aria-label="Your account"
        aria-current={current ? "page" : undefined}
        title={email ?? "Your account"}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cream text-base font-semibold text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {accountInitial({ firstName: user.firstName, email })}
      </Link>
    );
  }

  if (pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up")) {
    return null;
  }
  const back = pathname && pathname !== "/" ? pathname : "/account";
  return (
    <Link
      href={`/sign-in?redirect_url=${encodeURIComponent(back)}`}
      className="flex min-h-11 shrink-0 items-center rounded-full px-2 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      Sign in
    </Link>
  );
}
