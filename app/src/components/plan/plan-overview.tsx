"use client";

import type {
  Brief,
  HomeBudgetResponse,
  HomeOverview,
  Layout,
  OverviewRoom,
} from "@stepchange/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatPence,
  formatPenceRange,
  formatRoomSize,
} from "@/lib/plan/format";
import {
  BUDGET_STATUS_TEXT,
  deriveRoomStatus,
  isBriefUsable,
  productCountForRoom,
  ROOM_STATUS_LABELS,
  ROOM_STATUS_PROGRESS,
  type RoomPlanStatus,
} from "@/lib/plan/status";
import { useCurrentHome } from "@/lib/plan/use-home";
import { ApiError, readJson, useServer } from "@/lib/server";
import {
  btnPrimary,
  Card,
  Eyebrow,
  errorMessage,
  Notice,
  Pill,
  PlanFrame,
  type Tone,
} from "./ui";

type RoomState = {
  room: OverviewRoom;
  brief: Brief | null;
  layout: Layout | null;
  status: RoomPlanStatus;
};

const STATUS_TONE: Record<RoomPlanStatus, Tone> = {
  needs_measurement: "warn",
  needs_review: "warn",
  ready_for_brief: "none",
  brief_draft: "info",
  brief_ready: "info",
  layout_needs_attention: "warn",
  layout_verified: "ok",
  products_chosen: "ok",
};

const NEXT_STEP: Record<RoomPlanStatus, string> = {
  needs_measurement:
    "Measure this room so furniture sizes can be checked. You can still draft a brief, but nothing will be marked as a verified fit.",
  needs_review:
    "Check its size, doors and windows, then create the functional brief.",
  ready_for_brief: "Create the functional brief: what this room needs to do.",
  brief_draft: "Review the draft brief and accept or edit it.",
  brief_ready: "Plan the layout to check everything fits.",
  layout_needs_attention:
    "The layout has conflicts or unverified measurements. Open it to see why.",
  layout_verified: "Layout fits. Explore a visual concept and find products.",
  products_chosen: "Products chosen. Check prices before you buy.",
};

const STEPS = ["Brief", "Layout", "Concept & shop"];

export function PlanOverview() {
  const home = useCurrentHome();
  return (
    <PlanFrame
      home={home}
      eyebrow="07 / Your plan"
      title="Your home plan."
      intro={
        <p>
          Function first: each room gets a brief, a to-scale layout, then ideas
          and real products. Nothing is marked as a verified fit unless its
          measurements are confirmed.
        </p>
      }
      back={{ href: "/journey/review", label: "Back to my brief" }}
    >
      {(homeId) => <Overview homeId={homeId} />}
    </PlanFrame>
  );
}

function Overview({ homeId }: { homeId: string }) {
  const { client } = useServer();
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [budget, setBudget] = useState<HomeBudgetResponse | null>(null);
  const [rooms, setRooms] = useState<RoomState[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ov, bud] = await Promise.all([
          readJson<HomeOverview>(
            await client.homes[":homeId"].overview.$get({ param: { homeId } }),
          ),
          readJson<HomeBudgetResponse>(
            await client.products.budget.homes[":homeId"].$get({
              param: { homeId },
            }),
          ).catch(() => null),
        ]);
        if (cancelled) return;
        setOverview(ov);
        setBudget(bud);
        const selected = ov.rooms.filter((r) => r.selected);
        const states = await Promise.all(
          selected.map(async (room): Promise<RoomState> => {
            const { briefs } = await readJson<{ briefs: Brief[] }>(
              await client.plans.rooms[":roomId"].briefs.$get({
                param: { roomId: room.id },
              }),
            );
            const brief =
              briefs.find((b) => isBriefUsable(b)) ??
              briefs.find((b) => b.status === "draft") ??
              null;
            let layout: Layout | null = null;
            if (brief && isBriefUsable(brief)) {
              try {
                layout = (
                  await readJson<{ layout: Layout }>(
                    await client.plans.briefs[":briefId"].layout.$get({
                      param: { briefId: brief.id },
                    }),
                  )
                ).layout;
              } catch (e) {
                if (!(e instanceof ApiError && e.status === 404)) throw e;
              }
            }
            return {
              room,
              brief,
              layout,
              status: deriveRoomStatus({
                room,
                brief,
                layout,
                productCount: productCountForRoom(bud, room.id),
              }),
            };
          }),
        );
        if (!cancelled) setRooms(states);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Couldn't load your plan."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, homeId]);

  if (error) {
    return (
      <Notice tone="bad" role="alert" title="Couldn't load your plan">
        <p>{error}</p>
      </Notice>
    );
  }
  if (!overview) {
    return (
      <p role="status" className="text-muted">
        Loading rooms…
      </p>
    );
  }

  const unselected = overview.rooms.length - overview.summary.selectedRooms;
  const warnings = overview.warnings.filter((w) => w.severity === "warning");
  const infos = overview.warnings.filter((w) => w.severity !== "warning");

  return (
    <>
      <p className="-mt-3 font-serif text-2xl">{overview.home.name}</p>
      <BudgetSummary budget={budget} />

      {(warnings.length > 0 || infos.length > 0) && (
        <Card aria-labelledby="checks-heading">
          <Eyebrow>Before you rely on the plan</Eyebrow>
          <h2 id="checks-heading" className="font-serif text-2xl">
            Things to check
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {[...warnings, ...infos].map((w) => (
              <li
                key={`${w.code}-${w.roomId ?? "home"}`}
                className={`rounded-2xl px-4 py-3 ${w.severity === "warning" ? "bg-amber-300/10 text-amber-100" : "bg-white/5 text-muted"}`}
              >
                {w.message}
                {(w.action === "measure_room" ||
                  w.action === "review_room" ||
                  w.action === "measure_feature") && (
                  <>
                    {" "}
                    <Link href="/journey/rooms" className="underline">
                      Edit rooms
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby="rooms-heading" className="flex flex-col gap-3">
        <h2 id="rooms-heading" className="font-serif text-2xl">
          Rooms in this plan
        </h2>
        {overview.rooms.length === 0 && (
          <Card>
            <p className="text-sm text-muted">
              No rooms yet. Add the rooms you want to plan.
            </p>
            <Link href="/journey/rooms" className={btnPrimary}>
              Add rooms
            </Link>
          </Card>
        )}
        {overview.rooms.length > 0 && overview.summary.selectedRooms === 0 && (
          <Card>
            <p className="text-sm text-muted">
              No rooms are selected for planning yet.
            </p>
            <Link href="/journey/rooms" className={btnPrimary}>
              Choose rooms
            </Link>
          </Card>
        )}
        {rooms === null && overview.summary.selectedRooms > 0 && (
          <p role="status" className="text-muted">
            Checking each room's progress…
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {rooms?.map((s) => (
            <li key={s.room.id}>
              <RoomCard state={s} budget={budget} />
            </li>
          ))}
        </ul>
        {unselected > 0 && (
          <p className="text-sm text-muted">
            {unselected} other room{unselected === 1 ? " is" : "s are"} not part
            of this plan.
          </p>
        )}
      </section>

      <Link href="/plan/budget" className={`${btnPrimary} min-h-14 text-lg`}>
        Build my home plan
      </Link>
    </>
  );
}

function RoomCard({
  state,
  budget,
}: {
  state: RoomState;
  budget: HomeBudgetResponse | null;
}) {
  const { room, status } = state;
  const progress = ROOM_STATUS_PROGRESS[status];
  const roomBudget = budget?.rooms.find((r) => r.roomId === room.id);
  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xl">{room.name}</h3>
          <p className="text-sm text-muted">
            {formatRoomSize(room.widthCm, room.lengthCm)}
            {room.dimensionState !== "known" &&
              ` · ${room.dimensionState === "estimated" ? "estimated" : "unknown"}`}
          </p>
        </div>
        <Pill tone={STATUS_TONE[status]}>{ROOM_STATUS_LABELS[status]}</Pill>
      </div>
      <ol className="grid grid-cols-3 gap-1 text-center text-[11px]">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className={`rounded-xl py-1.5 ${i < progress ? "bg-cream text-ink" : i === progress ? "border border-cream/50" : "bg-white/5 text-muted"}`}
          >
            {i < progress ? "✓ " : ""}
            {step}
            <span className="sr-only">
              {i < progress ? " (done)" : i === progress ? " (next)" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">{NEXT_STEP[status]}</p>
      {roomBudget && roomBudget.totals.totalHighPence > 0 && (
        <p className="text-sm">
          Room total:{" "}
          {formatPenceRange(
            roomBudget.totals.totalLowPence,
            roomBudget.totals.totalHighPence,
          )}
          {roomBudget.totals.estimateHighPence > 0 && (
            <span className="text-muted"> (includes estimates)</span>
          )}
        </p>
      )}
      <Link
        href={`/plan/rooms/${room.id}`}
        className={btnPrimary}
        aria-label={`Open ${room.name} plan`}
      >
        Open room plan
      </Link>
    </article>
  );
}

function BudgetSummary({ budget }: { budget: HomeBudgetResponse | null }) {
  if (!budget) return null;
  const s = BUDGET_STATUS_TEXT[budget.status];
  const t = budget.totals;
  return (
    <Card aria-labelledby="budget-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Whole-home budget</Eyebrow>
        <Pill tone={s.tone}>{s.label}</Pill>
      </div>
      <h2 id="budget-heading" className="font-serif text-3xl">
        {t.totalHighPence > 0
          ? formatPenceRange(t.totalLowPence, t.totalHighPence)
          : "Nothing priced yet"}
      </h2>
      <p className="text-sm text-muted">
        {budget.householdBudgetPence != null
          ? `of your ${formatPence(budget.householdBudgetPence)} budget`
          : "Add a budget in your brief to compare."}
        {t.estimateHighPence > 0 &&
          ` · ${formatPenceRange(t.estimateLowPence, t.estimateHighPence)} is estimated`}
      </p>
      <Link href="/plan/budget" className="text-sm underline">
        See budget and shopping list
      </Link>
    </Card>
  );
}
