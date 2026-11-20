import Link from "next/link";
import { Brand } from "@/components/brand";

export default function PlanPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-6">
      <Brand trailing="Preview" />
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        07 / Your plan
      </p>
      <h1 className="font-serif text-4xl leading-tight">
        Your plan is on its way.
      </h1>
      <p className="text-muted">
        Room briefs, feasible layouts, visual concepts and shoppable lists will
        appear here. Layouts are only marked as verified fit when measurements
        are confirmed.
      </p>
      <section className="rounded-3xl border border-white/10 bg-card p-5 text-sm text-muted">
        Planning is not live in this preview.
      </section>
      <Link
        href="/journey/review"
        className="mt-auto flex min-h-14 items-center justify-center rounded-3xl bg-cream text-lg font-semibold text-ink"
      >
        Back to my brief
      </Link>
    </main>
  );
}
