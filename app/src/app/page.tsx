import { HealthResponseSchema } from "@stepchange/shared";
import { api } from "@/lib/api";

type ServerStatus =
  | { ok: true; service: string; version: string }
  | { ok: false };

async function getServerStatus(): Promise<ServerStatus> {
  try {
    const res = await api.health.$get(undefined, {
      init: { cache: "no-store" },
    });
    if (!res.ok) return { ok: false };

    const body = HealthResponseSchema.parse(await res.json());
    return { ok: true, service: body.service, version: body.version };
  } catch {
    return { ok: false };
  }
}

export default async function Home() {
  const status = await getServerStatus();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">Home Furnishing Planner</h1>
      <p className="text-sm text-neutral-500">
        See how a home could work for your real life before you spend money
        furnishing it.
      </p>
      <p
        className="rounded-full border px-4 py-2 text-sm"
        data-testid="server-status"
      >
        Server:{" "}
        {status.ok
          ? `ok (${status.service} v${status.version})`
          : "unreachable"}
      </p>
    </main>
  );
}
