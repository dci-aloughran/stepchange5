// Helpers for the journey end-to-end test.
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { APP, SERVER } from "./session.mjs";

// GET a server route as the signed-in user of `page`.
export async function serverGet(page, path) {
  const token = await page.evaluate(() => window.Clerk?.session?.getToken());
  if (!token) throw new Error("No Clerk session token");
  const res = await fetch(`${SERVER}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: APP },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return body;
}

// Everything the journey should have saved, read back from the server.
export async function serverSnapshot(page) {
  const homes = await serverGet(page, "/homes");
  const home = homes[0];
  const rooms = home ? await serverGet(page, `/homes/${home.id}/rooms`) : [];
  const [household, persons, needs, possessions, me] = await Promise.all([
    serverGet(page, "/profile/household"),
    serverGet(page, "/profile/persons"),
    serverGet(page, "/profile/accessibility"),
    serverGet(page, "/profile/possessions"),
    serverGet(page, "/profile/me"),
  ]);
  return { homes, home, rooms, household, persons, needs, possessions, me };
}

// A second, empty browser context signed in as the same Clerk user.
export async function freshSignedInPage(session, viewport) {
  const browser = session.page.context().browser();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(APP);
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, emailAddress: session.email });
  return { page, context };
}
