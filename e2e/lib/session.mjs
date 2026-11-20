// Shared helpers for browser end-to-end tests against a running app.
// Uses the locally installed Google Chrome (no browser download) and a
// throwaway Clerk test user that is always deleted afterwards.

import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";

export const APP = process.env.E2E_APP ?? "http://localhost:3000";
export const SERVER =
  process.env.E2E_SERVER ??
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "https://stepchange5-server.vercel.app";

const CLERK_API = "https://api.clerk.com/v1";
const clerkHeaders = () => ({
  Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
  "Content-Type": "application/json",
});

export function reporter() {
  const t0 = Date.now();
  let failures = 0;
  const log = (...a) =>
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  return {
    log,
    check(ok, msg) {
      if (!ok) failures++;
      log(ok ? "PASS" : "FAIL", msg);
    },
    fail(msg) {
      failures++;
      log("ERROR", msg);
    },
    get failures() {
      return failures;
    },
  };
}

// Starts a browser with a fresh Clerk test user. Call session.signIn() when the
// test needs an account, and always call session.close() in a finally block.
export async function startSession({
  viewport = { width: 390, height: 844 },
  headed = process.env.E2E_HEADED === "1",
  slowMo = 0,
  deviceScaleFactor = 1,
  windowSize = null,
} = {}) {
  const email = `e2e+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
  const res = await fetch(`${CLERK_API}/users`, {
    method: "POST",
    headers: clerkHeaders(),
    body: JSON.stringify({
      email_address: [email],
      skip_password_requirement: true,
    }),
  });
  const user = await res.json();
  if (!res.ok)
    throw new Error(`Clerk user create failed: ${JSON.stringify(user)}`);
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !headed,
    slowMo,
    args: windowSize
      ? [`--window-size=${windowSize.width},${windowSize.height}`]
      : [],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor });

  return {
    page,
    email,
    async signIn() {
      if (!page.url().startsWith(APP)) await page.goto(APP);
      await setupClerkTestingToken({ page });
      await clerk.signIn({ page, emailAddress: email });
    },
    async token() {
      return page
        .evaluate(() => window.Clerk?.session?.getToken())
        .catch(() => null);
    },
    // Deletes all server-side data for the test user, then the Clerk user.
    async close(log = console.log) {
      try {
        const token = await this.token();
        if (token) {
          const r = await fetch(`${SERVER}/profile`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, Origin: APP },
          });
          log("cleanup DELETE /profile →", r.status);
        }
      } catch (e) {
        log("cleanup server data failed:", e.message);
      }
      await fetch(`${CLERK_API}/users/${user.id}`, {
        method: "DELETE",
        headers: clerkHeaders(),
      }).catch(() => {});
      log("cleanup Clerk test user deleted");
      await browser.close();
    },
  };
}

// A simple floor plan image with printed room sizes (2 bedrooms shown).
export async function sampleFloorPlanPng() {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="#fff"/>
    <g fill="none" stroke="#000" stroke-width="6"><rect x="40" y="40" width="460" height="380"/><rect x="500" y="40" width="460" height="300"/>
    <rect x="500" y="340" width="460" height="320"/><rect x="40" y="420" width="260" height="240"/><rect x="300" y="420" width="200" height="240"/></g>
    <g font-family="Arial" font-size="26" text-anchor="middle"><text x="270" y="220">LIVING ROOM</text><text x="270" y="255">4.60m x 3.80m</text>
    <text x="730" y="180">KITCHEN / DINER</text><text x="730" y="215">4.60m x 3.00m</text><text x="730" y="490">BEDROOM 1</text><text x="730" y="525">3.60m x 3.20m</text>
    <text x="170" y="530">BEDROOM 2</text><text x="170" y="565">2.60m x 2.40m</text><text x="400" y="530">BATHROOM</text><text x="400" y="565">2.00m x 2.40m</text></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
