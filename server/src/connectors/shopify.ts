// Shopify UCP catalogue connector (FR-18..FR-21, FR-28).
// MCP JSON-RPC over Streamable HTTP against the current /api/ucp/mcp
// endpoint (never the deprecated /api/mcp tools). Every request presents the
// UCP agent profile in arguments.meta["ucp-agent"].profile (FR-20).
// Failures never throw: they return { status: "unavailable", reason }.

import { audit } from "../lib/audit.js";
import { isKilled, KILL_SWITCHES } from "../lib/guards.js";
import {
  type NormalisedProduct,
  normaliseProduct,
  stripQuery,
  type UcpProduct,
} from "./shopify-normalise.js";

// Shopify's hosted example profile works for evaluation; production should
// set SHOPIFY_UCP_AGENT_PROFILE_URL to a profile we host (see report).
const DEFAULT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json";

export function shopifyConfig() {
  return {
    endpoint:
      process.env.SHOPIFY_UCP_CATALOG_URL ??
      "https://catalog.shopify.com/api/ucp/mcp",
    profileUrl: process.env.SHOPIFY_UCP_AGENT_PROFILE_URL ?? DEFAULT_PROFILE,
    timeoutMs: Number(process.env.SHOPIFY_TIMEOUT_MS ?? 8000),
    maxAttempts: Number(process.env.SHOPIFY_MAX_ATTEMPTS ?? 2),
  };
}

export type ConnectorResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" | "disabled"; reason: string };

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
let sleepImpl = (ms: number) => new Promise((r) => setTimeout(r, ms));
let killCheck = () => isKilled(KILL_SWITCHES.shopify);
// Test seam.
export function __setTestHooks(h: {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  killed?: () => Promise<boolean>;
}) {
  if (h.fetch) fetchImpl = h.fetch;
  if (h.sleep) sleepImpl = h.sleep;
  if (h.killed) killCheck = h.killed;
}

let rpcId = 0;

class RetryableError extends Error {}

function parseBody(text: string, contentType: string | null): unknown {
  if (contentType?.includes("text/event-stream")) {
    // Streamable HTTP may answer with SSE; take the last JSON data frame.
    const frames = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    const last = frames.at(-1);
    return last ? JSON.parse(last) : null;
  }
  return JSON.parse(text);
}

async function callToolOnce(
  name: string,
  catalog: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cfg = shopifyConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method: "tools/call",
        params: {
          name,
          arguments: {
            meta: { "ucp-agent": { profile: cfg.profileUrl } },
            catalog,
          },
        },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new RetryableError(
      ctrl.signal.aborted ? "timeout" : `network: ${String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableError(`http_${res.status}`);
  }
  let body: {
    result?: {
      structuredContent?: Record<string, unknown>;
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    error?: { message?: string; data?: { code?: string } };
  };
  try {
    body = parseBody(text, res.headers.get("content-type")) as typeof body;
  } catch {
    throw new Error(`invalid_response (http ${res.status})`);
  }
  if (body?.error) {
    throw new Error(
      `${body.error.message ?? "rpc_error"}${body.error.data?.code ? `: ${body.error.data.code}` : ""}`,
    );
  }
  const result = body?.result;
  if (!result) throw new Error(`empty_result (http ${res.status})`);
  if (result.isError) {
    throw new Error(`tool_error: ${result.content?.[0]?.text ?? "unknown"}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const t = result.content?.find((c) => c.type === "text")?.text;
  if (t) return JSON.parse(t) as Record<string, unknown>;
  throw new Error("no_content");
}

export async function callTool(
  name: "search_catalog" | "lookup_catalog" | "get_product",
  catalog: Record<string, unknown>,
): Promise<ConnectorResult<Record<string, unknown>>> {
  try {
    if (await killCheck()) {
      return {
        status: "disabled",
        reason: "Shopify catalogue is temporarily switched off.",
      };
    }
  } catch {
    // Kill switch lookup failed; continue (env switch already checked).
  }
  const cfg = shopifyConfig();
  let lastError = "unknown";
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return { status: "ok", data: await callToolOnce(name, catalog) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!(err instanceof RetryableError) || attempt === cfg.maxAttempts) {
        break;
      }
      // Exponential backoff with full jitter.
      const base = 250 * 2 ** (attempt - 1);
      await sleepImpl(base + Math.floor(Math.random() * base));
    }
  }
  // FR-28 source-level monitoring.
  await audit("connector.shopify.failure", {
    severity: "warn",
    payload: { tool: name, reason: lastError.slice(0, 300) },
  }).catch(() => {});
  return {
    status: "unavailable",
    reason: `Shopify catalogue unavailable (${lastError.slice(0, 120)})`,
  };
}

export type SearchParams = {
  query: string;
  intent?: string;
  minPricePence?: number;
  maxPricePence?: number;
  limit?: number;
};

const UK_CONTEXT = { address_country: "GB", currency: "GBP", language: "en" };

export async function searchCatalog(
  p: SearchParams,
): Promise<ConnectorResult<NormalisedProduct[]>> {
  const price: Record<string, number> = {};
  if (p.minPricePence) price.min = p.minPricePence;
  if (p.maxPricePence) price.max = p.maxPricePence;
  const r = await callTool("search_catalog", {
    query: p.query,
    view: "compact",
    filters: {
      ships_to: { country: "GB" },
      available: true,
      ...(Object.keys(price).length ? { price } : {}),
    },
    context: { ...UK_CONTEXT, ...(p.intent ? { intent: p.intent } : {}) },
    pagination: { limit: Math.min(p.limit ?? 10, 20) },
  });
  if (r.status !== "ok") return r;
  const retrievedAt = new Date();
  const products = (r.data.products as UcpProduct[] | undefined) ?? [];
  const seen = new Set<string>();
  const out: NormalisedProduct[] = [];
  for (const prod of products) {
    for (const n of normaliseProduct(prod, {
      retrievedAt,
      shipsToGbFiltered: true,
    })) {
      // Duplicate detection across offers/queries.
      const key = `${n.sourceProductId}|${n.sourceVariantId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return { status: "ok", data: out };
}

export type RefreshResult =
  | { found: true; product: NormalisedProduct }
  | { found: false };

// FR-19/FR-22: current details + checkout link for a known variant.
export async function refreshVariant(
  variantId: string,
): Promise<ConnectorResult<RefreshResult>> {
  const id = stripQuery(variantId);
  const r = await callTool("get_product", {
    id,
    view: "compact",
    filters: { ships_to: { country: "GB" }, available: false },
    context: UK_CONTEXT,
  });
  let product: UcpProduct | undefined;
  if (r.status === "ok") {
    product = r.data.product as UcpProduct | undefined;
  } else if (r.status === "disabled") {
    return r;
  }
  if (!product) {
    // Fall back to lookup_catalog, which reports not_found for delisted ids.
    const l = await callTool("lookup_catalog", {
      ids: [id],
      filters: { ships_to: { country: "GB" }, available: false },
      context: UK_CONTEXT,
    });
    if (l.status !== "ok") return r.status !== "ok" ? r : l;
    product = (l.data.products as UcpProduct[] | undefined)?.[0];
    if (!product) return { status: "ok", data: { found: false } };
  }
  const variants = normaliseProduct(product, {
    retrievedAt: new Date(),
    shipsToGbFiltered: true,
  });
  const match = variants.find((v) => v.sourceVariantId === id) ?? null;
  return match
    ? { status: "ok", data: { found: true, product: match } }
    : { status: "ok", data: { found: false } };
}
