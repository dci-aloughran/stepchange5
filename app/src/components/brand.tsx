import Link from "next/link";
import { AccountLink } from "./account-link";

export function Brand({ trailing }: { trailing?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Link
        href="/"
        className="min-w-0 text-2xl font-semibold tracking-tight whitespace-nowrap"
      >
        Deloitful<span className="text-accent">.</span>Home
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {trailing && (
          // Dropped on the narrowest screens so the header never wraps.
          <span className="text-xs tracking-[0.2em] text-muted uppercase max-[359px]:hidden">
            {trailing}
          </span>
        )}
        <AccountLink />
      </div>
    </div>
  );
}
