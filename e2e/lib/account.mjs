// Helpers for the account & privacy end-to-end test.
import { APP, SERVER } from "./session.mjs";

const CLERK_API = "https://api.clerk.com/v1";

// Calls the API server with the browser's Clerk session token.
export async function api(session, path, init = {}) {
  const token = await session.token();
  if (!token) throw new Error("No Clerk session token");
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: APP,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export async function clerkUserId(page) {
  return page.evaluate(() => window.Clerk?.user?.id ?? null);
}

// HTTP status of GET /v1/users/{id} on the Clerk Backend API (404 = gone).
export async function clerkUserStatus(userId) {
  const res = await fetch(`${CLERK_API}/users/${userId}`, {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
  });
  return res.status;
}

export async function localJourneyKeys(page) {
  return page.evaluate(() =>
    ["deloitful.journey", "deloitful.rooms"].filter(
      (k) => localStorage.getItem(k) !== null,
    ),
  );
}

// True when the page has no horizontal overflow (WCAG reflow).
export async function fitsWidth(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
}
