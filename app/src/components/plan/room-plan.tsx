"use client";

import type { Brief, HomeDetail, Layout, RoomDetail } from "@stepchange/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatRoomSize, titleCase } from "@/lib/plan/format";
import { isBriefUsable } from "@/lib/plan/status";
import { useCurrentHome } from "@/lib/plan/use-home";
import { ApiError, readJson, useServer } from "@/lib/server";
import { BriefSection } from "./brief-section";
import { ConceptSection } from "./concept-section";
import { LayoutSection } from "./layout-section";
import { ShopSection } from "./shop-section";
import { errorMessage, Notice, PlanFrame } from "./ui";

const STATUS_TEXT: Record<string, string> = {
  user_confirmed: "measured by you",
  source_printed: "from the floor plan",
  calculated: "calculated from the plan's scale",
  estimated: "estimated · needs measuring",
  unknown: "size unknown",
};

export function RoomPlan({ roomId }: { roomId: string }) {
  const home = useCurrentHome();
  return (
    <PlanFrame
      home={home}
      eyebrow="Room plan"
      title="Plan this room."
      back={{ href: "/plan", label: "All rooms" }}
    >
      {(homeId) => <RoomPlanBody homeId={homeId} roomId={roomId} />}
    </PlanFrame>
  );
}

// Latest brief that hasn't been rejected (or the latest if all were).
export function pickBrief(briefs: Brief[]): Brief | null {
  return briefs.find((b) => b.status !== "rejected") ?? briefs[0] ?? null;
}

function RoomPlanBody({ homeId, roomId }: { homeId: string; roomId: string }) {
  const { client } = useServer();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLayout = useCallback(
    async (b: Brief | null) => {
      if (!b || !isBriefUsable(b)) return null;
      try {
        return (
          await readJson<{ layout: Layout }>(
            await client.plans.briefs[":briefId"].layout.$get({
              param: { briefId: b.id },
            }),
          )
        ).layout;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await readJson<HomeDetail>(
          await client.homes[":homeId"].$get({ param: { homeId } }),
        );
        const r = detail.rooms.find((x) => x.id === roomId) ?? null;
        if (!r) {
          if (!cancelled) {
            setError("This room isn't part of your current home.");
            setLoaded(true);
          }
          return;
        }
        const { briefs } = await readJson<{ briefs: Brief[] }>(
          await client.plans.rooms[":roomId"].briefs.$get({
            param: { roomId },
          }),
        );
        const b = pickBrief(briefs);
        const l = await loadLayout(b);
        if (cancelled) return;
        setRoom(r);
        setBrief(b);
        setLayout(l);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e, "Couldn't load this room."));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, homeId, roomId, loadLayout]);

  if (!loaded) {
    return (
      <p role="status" className="text-muted">
        Loading room…
      </p>
    );
  }
  if (error || !room) {
    return (
      <Notice tone="bad" role="alert" title="Couldn't open this room">
        <p>{error}</p>
        <Link href="/plan" className="underline">
          Back to all rooms
        </Link>
      </Notice>
    );
  }

  const usable = isBriefUsable(brief);
  const sections = [
    { id: "brief", label: "Brief", done: usable },
    { id: "layout", label: "Layout", done: layout != null },
    { id: "concept", label: "Concept", done: false },
    { id: "shop", label: "Shop", done: false },
  ];

  return (
    <>
      <div className="-mt-3 flex flex-col gap-1">
        <p className="font-serif text-3xl">{room.name}</p>
        <p className="text-sm text-muted">
          {titleCase(room.roomType)} ·{" "}
          {formatRoomSize(room.widthCm, room.lengthCm)} ·{" "}
          {STATUS_TEXT[room.dimensionStatus] ?? room.dimensionStatus}
          {room.reviewedAt ? " · reviewed" : " · not reviewed yet"}
        </p>
      </div>
      <nav aria-label="Room plan steps">
        <ol className="grid grid-cols-4 gap-1 rounded-3xl border border-white/10 bg-card p-2 text-center text-xs">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={`flex min-h-11 flex-col items-center justify-center rounded-2xl ${s.done ? "bg-cream text-ink" : "text-muted"}`}
              >
                <span className="text-sm font-medium">
                  {s.done ? "✓" : i + 1}
                </span>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <BriefSection
        room={room}
        brief={brief}
        onBrief={(b) => {
          const briefChanged = b?.id !== brief?.id;
          setBrief(b);
          if (briefChanged || !isBriefUsable(b)) setLayout(null);
          if (briefChanged && isBriefUsable(b)) {
            void loadLayout(b).then(setLayout, () => {});
          }
        }}
      />
      <LayoutSection
        room={room}
        brief={usable ? brief : null}
        layout={layout}
        onLayout={setLayout}
      />
      <ConceptSection room={room} ready={usable && layout != null} />
      <ShopSection room={room} brief={usable ? brief : null} />
      <Link
        href="/plan/budget"
        className="inline-flex min-h-14 items-center justify-center rounded-3xl bg-cream text-lg font-semibold text-ink"
      >
        See whole-home budget
      </Link>
    </>
  );
}
