import { HealthResponseSchema } from "@stepchange/shared";
import Link from "next/link";
import { Brand } from "@/components/journey";
import { api } from "@/lib/api";

async function serverOk(): Promise<boolean> {
  try {
    const res = await api.health.$get(undefined, {
      init: { cache: "no-store" },
    });
    return res.ok && HealthResponseSchema.safeParse(await res.json()).success;
  } catch {
    return false;
  }
}

export default async function Start() {
  const ok = await serverOk();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-8 pb-6">
      <Brand />
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Development preview
      </p>
      <div className="mt-auto flex flex-col gap-4">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          Your home. In real life.
        </p>
        <h1 className="font-serif text-5xl leading-[1.05]">
          Before you buy. Before you furnish.
        </h1>
        <p className="text-lg">Plan how your real home could work for you.</p>
        <p className="text-muted">Needs first. Rooms next. Products last.</p>
        <p className="text-sm text-muted">
          Explore a sample journey. Planning, uploads and shopping are not live
          in this prototype.
        </p>
      </div>
      <Link
        href="/journey/home"
        className="flex min-h-14 items-center justify-center rounded-3xl bg-cream text-lg font-semibold text-ink"
      >
        Start with your home
      </Link>
      <p className="text-xs text-muted" data-testid="server-status">
        Server: {ok ? "ok" : "unreachable"}
      </p>
    </main>
  );
}
