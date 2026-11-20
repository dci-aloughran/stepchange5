"use client";

import type { TasteProfile } from "@stepchange/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { JourneyApi } from "@/lib/journey/api";
import {
  formatPounds,
  isRoomConfirmed,
  needProblem,
  needSummary,
  personLabel,
  possessionSize,
  poundsToPence,
} from "@/lib/journey/mapping";
import type { JourneyData, LocalPerson } from "@/lib/journey/types";
import { countOf, type PlanRoom } from "@/lib/rooms";

type Card = {
  n: string;
  label: string;
  slug: string;
  title: string;
  lines: string[];
};

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
function count(n: number, one: string, many: string) {
  const word = WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? one : many}`;
}

export function householdTitle(people: LocalPerson[]): string {
  if (!people.length) return "Household not added yet";
  const adults = people.filter((p) => p.role === "adult").length;
  const born = people.filter((p) => p.role === "child" && !p.onTheWay).length;
  const coming = people.filter((p) => p.role === "child" && p.onTheWay).length;
  const visitors = people.filter((p) => p.role === "regular_visitor").length;
  const parts: string[] = [];
  if (adults) parts.push(count(adults, "adult", "adults"));
  if (born) parts.push(count(born, "child", "children"));
  if (coming) {
    parts.push(coming === 1 ? "A baby on the way" : `${coming} babies due`);
  }
  if (visitors)
    parts.push(count(visitors, "regular visitor", "regular visitors"));
  return `${parts.join(". ")}.`;
}

function list(items: (string | false | null | undefined)[], sep = " · ") {
  return items.filter(Boolean).join(sep);
}

export function ReviewStep({
  data,
  rooms,
  api,
  isSignedIn,
}: {
  data: JourneyData;
  rooms: PlanRoom[] | null;
  api: JourneyApi;
  isSignedIn: boolean;
}) {
  const [taste, setTaste] = useState<
    | { state: "loading" }
    | { state: "ready"; profile: TasteProfile | null }
    | { state: "error" }
    | { state: "signed-out" }
  >({ state: "signed-out" });

  useEffect(() => {
    if (!isSignedIn) {
      setTaste({ state: "signed-out" });
      return;
    }
    let cancelled = false;
    setTaste({ state: "loading" });
    api
      .getTaste()
      .then((profile) => !cancelled && setTaste({ state: "ready", profile }))
      .catch(() => !cancelled && setTaste({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, [api, isSignedIn]);

  const people = data.people ?? [];
  const needs = data.needs ?? [];
  const items = data.possessions ?? [];
  const roomList = rooms ?? [];
  const roomName = (id?: string | null) =>
    roomList.find((r) => r.id === id)?.name;
  const budget = poundsToPence(data.budget);
  const confirmedRooms = roomList.filter((r) =>
    isRoomConfirmed(r, data.reviewedRooms),
  ).length;

  const needLine = (n: (typeof needs)[number]) => {
    const person = people.find((p) => p.id === n.personId);
    const where =
      n.scope === "room"
        ? (roomName(n.roomId) ?? "room not chosen")
        : n.scope === "person"
          ? person
            ? personLabel(people, person)
            : "person not chosen"
          : "whole home";
    const problem = needProblem(
      n,
      roomList.map((r) => r.id),
      people.map((p) => p.id),
    );
    return `${needSummary(n)} · ${where} · ${problem ? "incomplete" : n.confirmed ? "confirmed rule" : "preference"}`;
  };

  const lifestyle = data.lifestyle ?? {};
  const visitors = people.filter((p) => p.role === "regular_visitor");

  const cards: Card[] = [
    {
      n: "01",
      label: "Home",
      slug: "home",
      title: data.address?.trim() || "Your home",
      lines: [
        list([
          data.propertyType,
          data.beds && `${data.beds} beds`,
          data.baths && `${data.baths} bath`,
          data.area && `${data.area} m²`,
          poundsToPence(data.price)
            ? formatPounds(poundsToPence(data.price))
            : "",
        ]) || "Details not added yet",
        data.journey ?? "",
        rooms
          ? `${roomList.length} rooms · ${countOf(roomList, "bedroom")} bedrooms · ${confirmedRooms === roomList.length && roomList.length ? "all checked by you" : `${confirmedRooms} of ${roomList.length} checked`}`
          : "Rooms not checked yet",
      ].filter(Boolean),
    },
    {
      n: "02",
      label: "Household & access",
      slug: "needs",
      title: householdTitle(people),
      lines: [
        list([
          lifestyle.wfhDaysPerWeek != null &&
            `WFH ${lifestyle.wfhDaysPerWeek} days/week`,
          visitors.length > 0 &&
            `Visits: ${visitors.map((v) => personLabel(people, v)).join(", ")}`,
        ]),
        ...(needs.length
          ? needs.map(needLine)
          : ["No accessibility needs added"]),
      ].filter(Boolean),
    },
    {
      n: "03",
      label: "Style",
      slug: taste.state === "ready" && taste.profile ? "taste" : "style",
      title:
        taste.state === "ready" && taste.profile
          ? taste.profile.summary || "Taste profile saved"
          : "Taste not set yet",
      lines: [
        taste.state === "signed-out"
          ? "Sign in and add inspiration to see your interpreted taste."
          : taste.state === "loading"
            ? "Loading your taste profile…"
            : taste.state === "error"
              ? "We couldn't load your taste profile just now."
              : taste.profile
                ? list(
                    taste.profile.attributes
                      .slice(0, 4)
                      .map((a) => `${a.label}: ${a.value}`),
                  ) || "Interpreted from your inspiration · you can adjust it"
                : "Add inspiration to see how we read your taste.",
        taste.state === "ready" && taste.profile
          ? "AI-interpreted from your inspiration · you can adjust it"
          : "",
      ].filter(Boolean),
    },
    {
      n: "04",
      label: "Keep",
      slug: "keep",
      title: items.length
        ? list(
            items.map((i) => i.name.trim() || i.category),
            ", ",
          )
        : "Nothing kept yet",
      lines: [
        ...items.map((i) =>
          list([
            i.name.trim() || i.category,
            possessionSize(i),
            roomName(i.roomId),
            i.keep ? "must keep" : "optional",
          ]),
        ),
        data.find?.trim() ? `Find: ${data.find.trim()}` : "",
      ].filter(Boolean),
    },
    {
      n: "05",
      label: "Budget",
      slug: "budget",
      title: budget != null ? formatPounds(budget) : "Budget not set",
      lines: [
        (data.priorities ?? []).join(" · "),
        data.timing?.trim() ?? "",
      ].filter(Boolean),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {cards.map((c) => (
        <Link
          key={c.n}
          href={`/journey/${c.slug}`}
          className="rounded-3xl border border-white/10 bg-card p-5 focus-visible:outline-2 focus-visible:outline-cream"
        >
          <p className="text-xs tracking-[0.2em] text-muted uppercase">
            {c.n} {c.label} ↗
          </p>
          <h2 className="mt-3 font-serif text-2xl">{c.title}</h2>
          {c.lines.map((l) => (
            <p key={l} className="mt-2 text-sm text-muted">
              {l}
            </p>
          ))}
        </Link>
      ))}
    </div>
  );
}
