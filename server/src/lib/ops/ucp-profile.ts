import { createHash } from "node:crypto";

// FR-20: our own UCP platform ("agent") profile for Deloitful.Home. Shopify's
// catalogue fetches it from the URL we send in meta["ucp-agent"].profile and
// intersects these capabilities with its own. The structure mirrors Shopify's
// reference fixture (shopify.dev/ucp/agent-profiles/examples/2026-08-25/
// valid-with-capabilities.json), limited to the read-only catalogue
// capabilities the connector actually uses: no checkout, cart or payments.
//
// The UCP profile format has no name field: the agent is identified by the
// profile URL, which is served from our own domain at
// /internal/ucp/agent-profile.json.

export const UCP_VERSION = "2026-08-25";

const CATALOG_EXTENDS = [
  "dev.ucp.shopping.catalog.lookup",
  "dev.ucp.shopping.catalog.search",
];

export const UCP_AGENT_PROFILE = {
  ucp: {
    version: UCP_VERSION,
    services: {
      "dev.ucp.shopping": [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
          transport: "mcp",
          schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/mcp.openrpc.json`,
        },
      ],
    },
    capabilities: {
      "dev.ucp.shopping.catalog.search": [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/search`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
        },
      ],
      "dev.ucp.shopping.catalog.lookup": [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/lookup`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`,
        },
      ],
      "dev.shopify.catalog": [
        {
          version: UCP_VERSION,
          spec: "https://shopify.dev/docs/agents/catalog/storefront-catalog",
          schema: `https://shopify.dev/ucp/schemas/${UCP_VERSION}/shopify_catalog.json`,
          extends: CATALOG_EXTENDS,
        },
      ],
      "dev.shopify.catalog.global": [
        {
          version: UCP_VERSION,
          spec: "https://shopify.dev/docs/agents/catalog/global-catalog",
          schema: `https://shopify.dev/ucp/schemas/${UCP_VERSION}/shopify_catalog_global.json`,
          extends: CATALOG_EXTENDS,
        },
      ],
    },
    payment_handlers: {},
  },
};

// Serialised once: the body and its ETag are stable for a deployment.
export const UCP_AGENT_PROFILE_BODY = JSON.stringify(UCP_AGENT_PROFILE);
export const UCP_AGENT_PROFILE_ETAG = `"${createHash("sha256")
  .update(UCP_AGENT_PROFILE_BODY)
  .digest("base64url")
  .slice(0, 27)}"`;

// UCP: public, max-age >= 60s, never private/no-store/no-cache.
export const UCP_AGENT_PROFILE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
