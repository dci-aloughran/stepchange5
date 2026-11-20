"use client";

import type {
  BudgetLine,
  HomeBudgetResponse,
  RoomRecommendationsResponse,
} from "@stepchange/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPence, formatPenceRange, titleCase } from "@/lib/plan/format";
import { EXCLUDED_REASON_TEXT } from "@/lib/plan/products";
import {
  BUDGET_STATUS_TEXT,
  budgetShare,
  buildShoppingList,
  firstOverBudgetIndex,
  type Priority,
} from "@/lib/plan/status";
import { useCurrentHome } from "@/lib/plan/use-home";
import { readJson, useServer } from "@/lib/server";
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

const SOURCE: Record<BudgetLine["source"], { label: string; tone: Tone }> = {
  product: { label: "Live price", tone: "ok" },
  estimate: { label: "Estimate", tone: "none" },
  retained: { label: "Keeping yours", tone: "info" },
  unpriced: { label: "No price yet", tone: "warn" },
};
const PRIORITY_HEADING: Record<Priority, string> = {
  must: "Must have",
  should: "Should have",
  could: "Nice to have",
};

export function BudgetView() {
  const home = useCurrentHome();
  return (
    <PlanFrame
      home={home}
      eyebrow="Budget"
      title="Your home plan, costed."
      intro={
        <p>
          Live product prices where you've chosen products; clearly marked
          estimates everywhere else.
        </p>
      }
      back={{ href: "/plan", label: "All rooms" }}
    >
      {(homeId) => <Budget homeId={homeId} />}
    </PlanFrame>
  );
}

function Budget({ homeId }: { homeId: string }) {
  const { client } = useServer();
  const [budget, setBudget] = useState<HomeBudgetResponse | null>(null);
  const [priorities, setPriorities] = useState<Map<string, Priority>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await readJson<HomeBudgetResponse>(
          await client.products.budget.homes[":homeId"].$get({
            param: { homeId },
          }),
        );
        if (cancelled) return;
        setBudget(b);
        const map = new Map<string, Priority>();
        await Promise.all(
          b.rooms.map(async (room) => {
            const recs = await readJson<RoomRecommendationsResponse>(
              await client.products.rooms[":roomId"].$get({
                param: { roomId: room.roomId },
              }),
            ).catch(() => null);
            for (const r of recs?.requirements ?? []) {
              map.set(
                `${room.roomId}:${r.requirement.id}`,
                r.requirement.priority,
              );
            }
          }),
        );
        if (!cancelled) setPriorities(map);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Couldn't load your budget."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, homeId]);

  if (error) {
    return (
      <Notice tone="bad" role="alert" title="Couldn't load your budget">
        <p>{error}</p>
      </Notice>
    );
  }
  if (!budget) {
    return (
      <p role="status" className="text-muted">
        Adding up your rooms…
      </p>
    );
  }

  const t = budget.totals;
  const s = BUDGET_STATUS_TEXT[budget.status];
  const share = budgetShare(t.totalHighPence, budget.householdBudgetPence);
  const lowShare = budgetShare(t.totalLowPence, budget.householdBudgetPence);
  const list = buildShoppingList(budget, priorities);
  const overAt = firstOverBudgetIndex(list, budget.householdBudgetPence);
  const noBriefs = budget.rooms.every((r) => r.lines.length === 0);

  return (
    <>
      <Card aria-labelledby="total-heading" data-testid="budget-total">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Whole home</Eyebrow>
          <Pill tone={s.tone}>{s.label}</Pill>
        </div>
        <h2 id="total-heading" className="font-serif text-4xl">
          {formatPenceRange(t.totalLowPence, t.totalHighPence)}
        </h2>
        <p className="text-sm text-muted">
          {budget.householdBudgetPence != null ? (
            <>
              against your {formatPence(budget.householdBudgetPence)} budget
              {budget.status === "over" && budget.overByPence != null
                ? ` · over by at least ${formatPence(budget.overByPence)}`
                : budget.remainingLowPence != null &&
                    budget.remainingLowPence >= 0
                  ? ` · at least ${formatPence(budget.remainingLowPence)} left`
                  : " · could go over if prices land at the top of the range"}
            </>
          ) : (
            <>
              No household budget set.{" "}
              <Link href="/journey/budget" className="underline">
                Add one
              </Link>
            </>
          )}
        </p>
        {share != null && lowShare != null && (
          <div
            className="relative h-3 w-full overflow-hidden rounded-full bg-white/10"
            role="img"
            aria-label={`Spending range is ${Math.round(lowShare * 100)}% to ${Math.round(share * 100)}% of your budget`}
          >
            <div
              className="absolute inset-y-0 left-0 bg-cream/40"
              style={{ width: `${Math.min(100, share * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-cream"
              style={{ width: `${Math.min(100, lowShare * 100)}%` }}
            />
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-inset p-3">
            <dt className="text-xs text-muted">Live prices</dt>
            <dd className="text-lg">{formatPence(t.productPence)}</dd>
          </div>
          <div className="rounded-2xl bg-inset p-3">
            <dt className="text-xs text-muted">Estimates</dt>
            <dd className="text-lg">
              {formatPenceRange(t.estimateLowPence, t.estimateHighPence)}
            </dd>
          </div>
        </dl>
        {t.unpricedCount > 0 && (
          <p className="text-sm text-amber-200">
            {t.unpricedCount} item{t.unpricedCount === 1 ? " has" : "s have"} no
            price or estimate yet and{" "}
            {t.unpricedCount === 1 ? "isn't" : "aren't"} included.
          </p>
        )}
      </Card>

      {noBriefs && (
        <Notice tone="info" title="Nothing to cost yet">
          <p>Create and accept a brief for each room to see its costs.</p>
          <Link href="/plan" className="underline">
            Go to your rooms
          </Link>
        </Notice>
      )}

      <section aria-labelledby="rooms-costs" className="flex flex-col gap-3">
        <h2 id="rooms-costs" className="font-serif text-2xl">
          By room
        </h2>
        {budget.rooms.map((room) => (
          <Card key={room.roomId} data-testid="budget-room">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-xl">{room.name}</h3>
              <p className="text-lg">
                {room.lines.length
                  ? formatPenceRange(
                      room.totals.totalLowPence,
                      room.totals.totalHighPence,
                    )
                  : "—"}
              </p>
            </div>
            {room.briefIsDraft && (
              <p className="text-xs text-amber-200">
                Based on a draft brief you haven't accepted yet.
              </p>
            )}
            {room.lines.length === 0 ? (
              <p className="text-sm text-muted">
                No brief yet.{" "}
                <Link href={`/plan/rooms/${room.roomId}`} className="underline">
                  Create one
                </Link>
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {room.lines.map((l) => (
                  <li
                    key={l.requirementId}
                    className="flex flex-col gap-1 rounded-2xl bg-inset p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">
                        {titleCase(l.category)}
                        {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                      </span>
                      <span>
                        {l.source === "retained"
                          ? "£0"
                          : l.source === "unpriced"
                            ? "—"
                            : formatPenceRange(l.lowPence, l.highPence)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Pill tone={SOURCE[l.source].tone}>
                        {SOURCE[l.source].label}
                      </Pill>
                      {l.source === "product" && l.productTitle && (
                        <span>
                          {l.productTitle} · {l.retailer}
                        </span>
                      )}
                      {l.source !== "product" &&
                        l.excludedReason &&
                        l.excludedReason !== "no_recommendation" &&
                        l.productTitle && (
                          <span>
                            {l.productTitle} not counted:{" "}
                            {EXCLUDED_REASON_TEXT[l.excludedReason] ??
                              l.excludedReason}
                          </span>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/plan/rooms/${room.roomId}#shop`}
              className="text-sm underline"
            >
              Shop {room.name}
            </Link>
          </Card>
        ))}
      </section>

      {list.length > 0 && (
        <Card aria-labelledby="list-heading">
          <Eyebrow>Prioritised shopping list</Eyebrow>
          <h2 id="list-heading" className="font-serif text-2xl">
            Buy in this order
          </h2>
          <p className="text-sm text-muted">
            Must-haves first across every room, then the rest. The running total
            uses the top of each range.
          </p>
          <ol className="flex flex-col gap-2" data-testid="shopping-list">
            {list.map((item, i) => {
              const heading =
                i === 0 || list[i - 1]?.priority !== item.priority
                  ? PRIORITY_HEADING[item.priority]
                  : null;
              return (
                <li key={`${item.roomId}:${item.requirementId}`}>
                  {heading && (
                    <p className="mt-2 mb-1 text-xs tracking-[0.15em] text-muted uppercase">
                      {heading}
                    </p>
                  )}
                  {overAt === i && (
                    <p
                      role="note"
                      className="mb-2 rounded-xl bg-red-400/10 px-3 py-2 text-xs text-red-100"
                    >
                      From here on, items could take you over budget.
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-2 rounded-2xl bg-inset p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {titleCase(item.category)}
                        {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                        <span className="text-muted"> · {item.roomName}</span>
                      </p>
                      <p className="text-xs text-muted break-words">
                        {item.source === "product"
                          ? `${item.productTitle} · ${item.retailer}`
                          : item.description}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p>
                        {item.source === "unpriced"
                          ? "—"
                          : formatPenceRange(item.lowPence, item.highPence)}
                      </p>
                      <p className="text-xs text-muted">
                        {SOURCE[item.source].label}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        {budget.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <Link href="/plan" className={`${btnPrimary} min-h-14 text-lg`}>
        Back to rooms
      </Link>
    </>
  );
}
