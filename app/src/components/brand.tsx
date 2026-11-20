import Link from "next/link";
import { AccountLink } from "./account-link";

export function Brand({ trailing }: { trailing?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link href="/" className="text-2xl font-semibold tracking-tight">
        Deloitful<span className="text-accent">.</span>Home
      </Link>
      <div className="flex items-center gap-3">
        {trailing && (
          <span className="text-xs tracking-[0.2em] text-muted uppercase">
            {trailing}
          </span>
        )}
        <AccountLink />
      </div>
    </div>
  );
}
