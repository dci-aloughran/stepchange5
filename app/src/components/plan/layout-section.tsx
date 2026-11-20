"use client";

import type { Brief, Layout, RoomDetail } from "@stepchange/shared";
import { useState } from "react";
import {
  conflictSets,
  describePosition,
  placementKeys,
  placementRect,
  rotationLabel,
} from "@/lib/plan/schematic";
import { readJson, useServer } from "@/lib/server";
import { RoomSchematic } from "./room-schematic";
import {
  btnPrimary,
  btnQuiet,
  btnSecondary,
  Card,
  Eyebrow,
  errorMessage,
  Notice,
  Pill,
  Working,
} from "./ui";

const NEED_STATUS = {
  satisfied: { label: "Met", tone: "ok" },
  violated: { label: "Not met", tone: "bad" },
  not_evaluable: { label: "Can't check", tone: "warn" },
  not_assessed: { label: "Not assessed", tone: "none" },
} as const;

export function LayoutSection({
  room,
  brief,
  layout,
  onLayout,
}: {
  room: RoomDetail;
  brief: Brief | null;
  layout: Layout | null;
  onLayout: (l: Layout) => void;
}) {
  const { client } = useServer();
  const [busy, setBusy] = useState<null | "plan" | "repair" | "accept">(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function plan() {
    if (!brief) return;
    setBusy("plan");
    setError(null);
    setStatus("Planning the layout…");
    try {
      const { layout: l } = await readJson<{ layout: Layout }>(
        await client.plans.briefs[":briefId"].layout.$post({
          param: { briefId: brief.id },
        }),
      );
      onLayout(l);
      setStatus(
        l.validation?.verifiedFit
          ? "Layout planned. Everything fits."
          : "Layout planned, but it isn't verified yet. See why below.",
      );
    } catch (e) {
      setError(errorMessage(e, "Couldn't plan the layout."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function patch(kind: "repair" | "accept") {
    if (!layout) return;
    setBusy(kind);
    setError(null);
    try {
      const json =
        kind === "repair"
          ? {
              repair: true,
              placements: layout.placements.map((p) => ({
                requirementId: p.requirementId,
                label: p.label,
                xCm: p.xCm,
                yCm: p.yCm,
                rotationDeg: p.rotationDeg,
                widthCm: p.widthCm,
                depthCm: p.depthCm,
              })),
            }
          : { status: "accepted" as const };
      const { layout: l } = await readJson<{ layout: Layout }>(
        await client.plans.layouts[":layoutId"].$patch({
          param: { layoutId: layout.id },
          json,
        }),
      );
      onLayout(l);
      setStatus(
        kind === "accept"
          ? "Layout accepted."
          : l.validation?.conflicts.length
            ? "Moved what we could; some conflicts remain."
            : "Conflicts fixed.",
      );
    } catch (e) {
      setError(errorMessage(e, "Couldn't update the layout."));
    } finally {
      setBusy(null);
    }
  }

  const v = layout?.validation ?? null;
  const { errors, warnings } = conflictSets(v);

  return (
    <Card id="layout" aria-labelledby="layout-heading" className="scroll-mt-4">
      <Eyebrow>2 · Layout</Eyebrow>
      <h2 id="layout-heading" className="font-serif text-2xl">
        Does it fit?
      </h2>
      {!brief && (
        <p className="text-sm text-muted">
          Accept the brief first. The layout places exactly those items, to
          scale, keeping door swings and any access space clear.
        </p>
      )}
      {brief && !layout && busy !== "plan" && (
        <>
          <p className="text-sm text-muted">
            We place each required item in the room to scale and check it
            against doors, windows, routes and confirmed access needs.
          </p>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void plan()}
          >
            Plan the layout
          </button>
        </>
      )}
      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {busy === "plan" && (
          <Working
            label="Placing furniture and checking the fit…"
            expected="Usually 10–40 seconds."
          />
        )}
        {status && busy !== "plan" && <p className="text-muted">{status}</p>}
      </div>
      {error && (
        <Notice tone="bad" role="alert">
          <p>{error}</p>
        </Notice>
      )}

      {layout && busy !== "plan" && (
        <>
          <div
            className="flex flex-wrap gap-2"
            data-testid="layout-verification"
          >
            <Pill tone={v?.verifiedFit ? "ok" : "warn"}>
              {v?.verifiedFit ? "✓ Verified fit" : "Fit not verified"}
            </Pill>
            <Pill tone={v?.verifiedAccessible ? "ok" : "warn"}>
              {v?.verifiedAccessible
                ? "✓ Access needs met"
                : "Access not verified"}
            </Pill>
            {layout.status === "accepted" && <Pill tone="info">Accepted</Pill>}
          </div>
          {v && v.reasons.length > 0 && (
            <Notice tone="warn" title="Why this isn't verified">
              <ul className="list-disc space-y-1 pl-5">
                {v.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          )}

          <RoomSchematic
            layout={layout}
            features={room.features}
            roomName={room.name}
          />

          {v && v.conflicts.length > 0 && (
            <div>
              <h3 className="text-lg">Conflicts</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {v.conflicts.map((c, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: conflicts can repeat
                    key={i}
                    className="rounded-xl bg-red-400/10 px-3 py-2 text-red-100"
                  >
                    {c.kind === "accessibility" ? "Access: " : ""}
                    {c.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v && v.warnings.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2">
                {v.warnings.length} thing{v.warnings.length === 1 ? "" : "s"} to
                be aware of
              </summary>
              <ul className="flex flex-col gap-1">
                {v.warnings.map((w, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: warnings can repeat
                    key={i}
                    className="rounded-xl bg-amber-300/10 px-3 py-2 text-amber-100"
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {v && v.needs.length > 0 && (
            <div>
              <h3 className="text-lg">Access needs</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {v.needs.map((n, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: needs can repeat
                    key={i}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Pill tone={NEED_STATUS[n.status].tone}>
                      {NEED_STATUS[n.status].label}
                    </Pill>
                    <span>{n.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="text-lg">Placed items</h3>
            <ul
              className="mt-1 flex flex-col gap-1 text-sm"
              aria-label="Placed items"
            >
              {layout.placements.map((p, i) => {
                const r = placementRect(p);
                const key = placementKeys(layout.placements)[i];
                const flag = errors.has(p.requirementId)
                  ? " · conflict"
                  : warnings.has(p.requirementId)
                    ? " · check"
                    : "";
                return (
                  <li key={key} className="rounded-xl bg-inset px-3 py-2">
                    <span className="font-medium">{p.label}</span>{" "}
                    <span className="text-muted">
                      {Math.round(p.widthCm)} × {Math.round(p.depthCm)} cm
                      {rotationLabel(p.rotationDeg)} ·{" "}
                      {layout.room.widthCm != null &&
                      layout.room.lengthCm != null
                        ? describePosition(
                            r,
                            layout.room.widthCm,
                            layout.room.lengthCm,
                          )
                        : "position unknown"}
                      {flag}
                    </span>
                  </li>
                );
              })}
              {layout.placements.length === 0 && (
                <li className="text-muted">Nothing placed.</li>
              )}
            </ul>
          </div>
          {v && v.notes.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="min-h-11 cursor-pointer py-2 text-sm">
                How this was checked
              </summary>
              <ul className="list-disc space-y-1 pl-5">
                {v.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-col gap-2">
            {v && v.conflicts.length > 0 && (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy !== null}
                onClick={() => void patch("repair")}
              >
                {busy === "repair" ? "Rearranging…" : "Try to fix conflicts"}
              </button>
            )}
            {layout.status !== "accepted" && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy !== null}
                onClick={() => void patch("accept")}
              >
                {busy === "accept" ? "Saving…" : "Accept layout"}
              </button>
            )}
            <button
              type="button"
              className={btnQuiet}
              disabled={busy !== null}
              onClick={() => void plan()}
            >
              Re-plan the layout
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
