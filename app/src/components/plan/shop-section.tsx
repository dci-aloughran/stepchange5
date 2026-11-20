"use client";

import type {
  Brief,
  RecommendationDto,
  RefreshRecommendationResponse,
  RequirementRecommendations,
  RoomDetail,
  RoomRecommendationsResponse,
  SwapIntent,
  SwapRecommendationResponse,
} from "@stepchange/shared";
import { useEffect, useState } from "react";
import {
  formatAge,
  formatBounds,
  formatPence,
  formatPenceRange,
  formatProductSize,
  titleCase,
} from "@/lib/plan/format";
import {
  handoffUrl,
  recommendationLabels,
  SWAP_INTENTS,
} from "@/lib/plan/products";
import { readJson, useServer } from "@/lib/server";
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

type Actions = {
  swap: (rec: RecommendationDto, intent: SwapIntent) => Promise<void>;
  buy: (rec: RecommendationDto) => Promise<void>;
  include: (rec: RecommendationDto, include: boolean) => Promise<void>;
  busyId: string | null;
};

function replaceRec(
  data: RoomRecommendationsResponse,
  previousId: string,
  next: RecommendationDto,
): RoomRecommendationsResponse {
  return {
    ...data,
    requirements: data.requirements.map((r) => ({
      ...r,
      recommendations: r.recommendations.map((x) =>
        x.id === previousId ? next : x,
      ),
    })),
  };
}

export function ShopSection({
  room,
  brief,
}: {
  room: RoomDetail;
  brief: Brief | null;
}) {
  const { client } = useServer();
  const [data, setData] = useState<RoomRecommendationsResponse | null>(null);
  const [finding, setFinding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the brief changes
  useEffect(() => {
    if (!brief) return;
    let cancelled = false;
    client.products.rooms[":roomId"]
      .$get({ param: { roomId: room.id } })
      .then((r) => readJson<RoomRecommendationsResponse>(r))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [client, room.id, brief?.id, brief?.updatedAt]);

  async function find() {
    setFinding(true);
    setError(null);
    setStatus("Searching participating retailers…");
    try {
      const d = await readJson<RoomRecommendationsResponse>(
        await client.products.rooms[":roomId"].recommend.$post({
          param: { roomId: room.id },
          json: { perRequirement: 3 },
        }),
      );
      setData(d);
      const count = d.requirements.reduce(
        (n, r) => n + r.recommendations.length,
        0,
      );
      setStatus(
        d.connector && d.connector.status !== "ok" && count === 0
          ? "The live catalogue isn't available, so only estimates are shown."
          : `Found ${count} product${count === 1 ? "" : "s"} for this room.`,
      );
    } catch (e) {
      setError(errorMessage(e, "Couldn't search for products."));
      setStatus("");
    } finally {
      setFinding(false);
    }
  }

  const actions: Actions = {
    busyId,
    async swap(rec, intent) {
      setBusyId(rec.id);
      setError(null);
      try {
        const res = await readJson<SwapRecommendationResponse>(
          await client.products.recommendations[":id"].swap.$post({
            param: { id: rec.id },
            json: { intent },
          }),
        );
        setData((d) =>
          d
            ? replaceRec(d, res.previousRecommendationId, res.recommendation)
            : d,
        );
        setStatus(
          res.outcome === "swapped"
            ? `Swapped to ${res.recommendation.product.title}.`
            : (res.message ??
                "No alternative found; your choice is unchanged."),
        );
      } catch (e) {
        setError(errorMessage(e, "Couldn't swap that product."));
      } finally {
        setBusyId(null);
      }
    },
    async buy(rec) {
      // Open the tab now (inside the click) so it isn't blocked as a popup,
      // then send it to the retailer once the price is re-checked.
      const win = window.open("", "_blank");
      if (win) {
        win.opener = null;
        win.document.title = "Checking price…";
        win.document.body.textContent =
          "Checking the latest price and availability…";
      }
      setBusyId(rec.id);
      setError(null);
      try {
        const res = await readJson<RefreshRecommendationResponse>(
          await client.products.recommendations[":id"].refresh.$post({
            param: { id: rec.id },
            json: { handoff: true },
          }),
        );
        setData((d) => (d ? replaceRec(d, rec.id, res.recommendation) : d));
        const url = handoffUrl(res.checkoutUrl, res.canonicalUrl);
        if (res.changes.delisted || !url) {
          win?.close();
          setStatus(
            res.message ??
              "This product can't be bought from the retailer right now.",
          );
          return;
        }
        const notes: string[] = [];
        if (res.changes.priceChanged) {
          notes.push(
            `Price changed from ${formatPence(res.changes.previousPricePence)} to ${formatPence(res.changes.currentPricePence)}.`,
          );
        }
        if (res.changes.availabilityChanged) {
          notes.push(
            `Availability is now ${res.changes.currentAvailability.replace("_", " ")}.`,
          );
        }
        if (!res.verified && res.message) notes.push(res.message);
        setStatus(
          `${notes.join(" ")} Opening ${res.recommendation.product.retailer} in a new tab.`.trim(),
        );
        if (win) win.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        win?.close();
        setError(errorMessage(e, "Couldn't check the latest price."));
      } finally {
        setBusyId(null);
      }
    },
    async include(rec, include) {
      setBusyId(rec.id);
      setError(null);
      try {
        const next = await readJson<RecommendationDto>(
          await client.products.recommendations[":id"].$patch({
            param: { id: rec.id },
            json: { includeInBudget: include },
          }),
        );
        setData((d) => (d ? replaceRec(d, rec.id, next) : d));
        setStatus(
          include
            ? `${rec.product.title} is counted in your budget.`
            : `${rec.product.title} is no longer counted; its estimate is used instead.`,
        );
      } catch (e) {
        setError(errorMessage(e, "Couldn't update the budget."));
      } finally {
        setBusyId(null);
      }
    },
  };

  const hasRecs = data?.requirements.some((r) => r.recommendations.length > 0);
  const connectorDown =
    data?.connector != null && data.connector.status !== "ok";

  return (
    <Card id="shop" aria-labelledby="shop-heading" className="scroll-mt-4">
      <Eyebrow>4 · Shop the room</Eyebrow>
      <h2 id="shop-heading" className="font-serif text-2xl">
        Real products that fit
      </h2>
      {!brief ? (
        <p className="text-sm text-muted">
          Requirements come before products: accept the brief first.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Ranked by fit to each requirement first. Prices come live from
            participating retailers; we re-check before you buy.
          </p>
          <button
            type="button"
            className={hasRecs ? btnSecondary : btnPrimary}
            disabled={finding || busyId !== null}
            onClick={() => void find()}
          >
            {finding
              ? "Searching…"
              : hasRecs
                ? "Search again"
                : "Find products"}
          </button>
          <div aria-live="polite" className="flex flex-col gap-2 text-sm">
            {finding && (
              <Working
                label="Searching participating retailers…"
                expected="Usually 5–20 seconds."
              />
            )}
            {status && !finding && (
              <p className="text-muted" data-testid="shop-status">
                {status}
              </p>
            )}
          </div>
          {error && (
            <Notice tone="bad" role="alert">
              <p>{error}</p>
            </Notice>
          )}
          {connectorDown && data?.connector && (
            <Notice
              tone="warn"
              title={
                data.connector.status === "partial"
                  ? "Some retailers couldn't be reached"
                  : "Live catalogue unavailable"
              }
            >
              <p data-testid="catalogue-unavailable">
                {data.connector.status === "partial"
                  ? "Some results may be missing."
                  : "We can't reach the retailer catalogue right now, so items show estimated price ranges only — not real products or live prices."}
              </p>
            </Notice>
          )}
          {data && (
            <ul className="flex flex-col gap-3">
              {data.requirements.map((r) => (
                <li key={r.requirement.id}>
                  <RequirementProducts item={r} actions={actions} />
                </li>
              ))}
            </ul>
          )}
          {data && data.disclosures.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              {data.disclosures.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function EstimateLine({ item }: { item: RequirementRecommendations }) {
  if (!item.estimate) {
    return <p className="text-sm text-muted">No price estimate available.</p>;
  }
  const q = item.requirement.quantity;
  return (
    <p className="text-sm">
      <Pill tone="none">Estimate</Pill>{" "}
      {formatPenceRange(item.estimate.lowPence, item.estimate.highPence)}
      {q > 1 ? " each" : ""}
      <span className="text-muted">
        {" "}
        · typical price range, not a live price
      </span>
    </p>
  );
}

function RequirementProducts({
  item,
  actions,
}: {
  item: RequirementRecommendations;
  actions: Actions;
}) {
  const { requirement: req, recommendations: recs } = item;
  const bounds = formatBounds(req);
  const [primary, ...alternatives] = recs;
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl bg-inset p-4"
      data-testid="requirement-products"
    >
      <header>
        <h3 className="font-medium">
          {titleCase(req.category)}
          {req.quantity > 1 && (
            <span className="text-muted"> × {req.quantity}</span>
          )}
        </h3>
        <p className="text-sm text-muted">{req.description}</p>
        {bounds && <p className="text-xs text-muted">Must fit: {bounds}</p>}
      </header>
      {item.state === "retained" && (
        <p className="text-sm">You're keeping your own — nothing to buy.</p>
      )}
      {item.state === "not_requested" && <EstimateLine item={item} />}
      {(item.state === "catalogue_unavailable" ||
        item.state === "no_match") && (
        <>
          {item.message && (
            <p className="text-sm text-amber-200">{item.message}</p>
          )}
          <EstimateLine item={item} />
        </>
      )}
      {primary && (
        <ProductCard
          rec={primary}
          actions={actions}
          primary
          quantity={req.quantity}
        />
      )}
      {alternatives.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm">
            {alternatives.length} alternative
            {alternatives.length === 1 ? "" : "s"}
          </summary>
          <ul className="flex flex-col gap-2">
            {alternatives.map((a) => (
              <li key={a.id}>
                <ProductCard
                  rec={a}
                  actions={actions}
                  quantity={req.quantity}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function ProductCard({
  rec,
  actions,
  primary = false,
  quantity,
}: {
  rec: RecommendationDto;
  actions: Actions;
  primary?: boolean;
  quantity: number;
}) {
  const p = rec.product;
  const labels = recommendationLabels(rec);
  const size = formatProductSize(p);
  const busy = actions.busyId === rec.id;
  const disabled = actions.busyId !== null;
  const image = p.imageUrls[0];
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card p-3"
      data-testid="product-card"
    >
      <div className="flex gap-3">
        {image ? (
          <figure className="w-24 shrink-0">
            {/* biome-ignore lint/performance/noImgElement: retailer-hosted image shown as-is with attribution (FR-23) */}
            <img
              src={image}
              alt={p.title}
              loading="lazy"
              className="aspect-square w-24 rounded-xl bg-white object-contain"
            />
          </figure>
        ) : (
          <div className="flex aspect-square w-24 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xs text-muted">
            No image
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted">
            {primary ? "Top pick · " : ""}
            {p.retailer}
          </p>
          <h4 className="font-medium break-words">{p.title}</h4>
          <p className="text-lg">
            {p.pricePence != null && p.currency === "GBP"
              ? formatPence(p.pricePence)
              : p.pricePence != null
                ? `${(p.pricePence / 100).toFixed(2)} ${p.currency ?? ""}`
                : "Price not available"}
            {quantity > 1 && p.pricePence != null && (
              <span className="text-sm text-muted"> each</span>
            )}
          </p>
          <p className="text-xs text-muted">
            Price checked {formatAge(p.retrievedAt)}
          </p>
          {size && <p className="text-xs text-muted">Size: {size}</p>}
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Labels">
        {labels.map((l) => (
          <li key={l.text}>
            <Pill tone={l.tone}>{l.text}</Pill>
          </li>
        ))}
      </ul>
      {rec.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">{p.attribution}</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={disabled}
          onClick={() => void actions.buy(rec)}
          aria-label={`Check price and buy ${p.title}`}
        >
          {busy ? "Working…" : "Check price & buy ↗"}
        </button>
        <details>
          <summary
            className={`${btnSecondary} w-full cursor-pointer list-none`}
            aria-label={`Swap ${p.title}`}
          >
            Swap…
          </summary>
          <fieldset className="mt-2 grid grid-cols-2 gap-2">
            <legend className="sr-only">{`Swap ${p.title} for something`}</legend>
            {SWAP_INTENTS.map((s) => (
              <button
                key={s.intent}
                type="button"
                className={btnQuiet}
                disabled={disabled}
                onClick={() => void actions.swap(rec, s.intent)}
              >
                {s.label}
              </button>
            ))}
          </fieldset>
        </details>
        {primary && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[#8bc34a]"
              checked={rec.includeInBudget}
              disabled={disabled}
              onChange={(e) => void actions.include(rec, e.target.checked)}
            />
            Count in my budget
            {!rec.includeInBudget && !rec.includeInBudgetSetByUser && (
              <span className="text-xs text-muted">
                (not counted:{" "}
                {rec.labels.unavailable
                  ? "out of stock"
                  : rec.labels.stale
                    ? "price over 24 h old"
                    : "no UK price"}
                )
              </span>
            )}
          </label>
        )}
      </div>
    </div>
  );
}
