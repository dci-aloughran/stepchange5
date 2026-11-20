// Rooms step: bedroom count, room editing, sign-in and floor-plan upload.
import { mkdirSync } from "node:fs";
import {
  APP,
  reporter,
  sampleFloorPlanPng,
  startSession,
} from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
const session = await startSession();
const { page } = session;

async function roomState() {
  return page.evaluate(() => ({
    status: document.querySelector("[role=status]")?.textContent ?? "",
    rooms: [...document.querySelectorAll("article h2")].map(
      (h) => h.textContent,
    ),
  }));
}
async function setJourney(patch) {
  await page.evaluate((p) => {
    const cur = JSON.parse(localStorage.getItem("deloitful.journey") ?? "{}");
    localStorage.setItem("deloitful.journey", JSON.stringify({ ...cur, ...p }));
  }, patch);
}

try {
  await page.goto(`${APP}/journey/home`);
  await page.evaluate(() => {
    localStorage.clear();
  });
  // Fill the home step through the real UI.
  await page.getByRole("button", { name: "Buying a home" }).click();
  await page.getByRole("button", { name: "House" }).click();
  await page.getByLabel("Address or name").fill("E2E Test House");
  await page.getByLabel("Bedrooms").fill("3");
  await page.getByLabel("Bathrooms").fill("1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/journey/rooms");
  await page.locator("[role=status]").waitFor();
  let s = await roomState();
  log("rooms:", s.rooms.join(" | "));
  check(
    /^3 bedrooms · 1 bathroom · matches your 3 beds house/.test(s.status),
    `3 bed house → "${s.status}"`,
  );
  await page.screenshot({
    path: `${OUT}01-rooms-template.png`,
    fullPage: true,
  });

  // Edit a bedroom's size.
  const bed2 = page.locator("article", {
    has: page.getByRole("heading", { name: "Bedroom 2" }),
  });
  await bed2.getByRole("button", { name: "Edit" }).click();
  await bed2.getByLabel("Width (m)").fill("3.1");
  await bed2.getByLabel("Length (m)").fill("2.7");
  await bed2.getByRole("button", { name: "Save room" }).click();
  check(
    (await bed2.textContent()).includes("3.1 × 2.7 m") &&
      (await bed2.textContent()).includes("Confirmed by you"),
    "edit Bedroom 2 → 3.1 × 2.7 m, confirmed",
  );

  // Rename.
  await bed2.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Room name").fill("Nursery");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  check(
    (await roomState()).rooms.includes("Nursery"),
    "rename Bedroom 2 → Nursery",
  );

  // Add + remove.
  await page.getByRole("button", { name: "+ Add a room" }).click();
  check((await roomState()).rooms.includes("New room"), "add a room");
  await page.getByRole("button", { name: "Remove New room" }).click();
  check(!(await roomState()).rooms.includes("New room"), "remove a room");

  // Changing the declared count updates the list (edited Nursery is kept).
  await setJourney({ beds: "4" });
  await page.reload();
  await page.locator("[role=status]").waitFor();
  s = await roomState();
  check(
    s.status.startsWith("4 bedrooms") && s.rooms.includes("Nursery"),
    `4 beds → "${s.status}"`,
  );
  await setJourney({ beds: "3" });
  await page.reload();
  await page.locator("[role=status]").waitFor();
  check((await roomState()).status.startsWith("3 bedrooms"), "back to 3 beds");

  // Sign in for upload.
  check(
    await page
      .getByRole("button", { name: "Sign in to upload" })
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      ),
    "signed out → 'Sign in to upload' shown",
  );
  await session.signIn();
  await page.reload();
  const input = page.locator("input[type=file]");
  await input.waitFor({ state: "attached", timeout: 15000 });
  check(true, "signed in → file picker available");

  // Upload a floor plan that only shows 2 bedrooms.
  const png = await sampleFloorPlanPng();
  await input.setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: png,
  });
  log("uploading + extracting…");
  await page
    .getByText(/Found \d+ rooms?|couldn't|went wrong|failed/i)
    .first()
    .waitFor({ timeout: 150000 });
  const outcome = await page.locator("[aria-live=polite]").textContent();
  log("upload outcome:", outcome);
  s = await roomState();
  log("rooms after plan:", s.rooms.join(" | "));
  const notes = await page
    .locator("article p.text-amber-200")
    .allTextContents();
  check(/Found \d+ rooms/.test(outcome), "floor plan uploaded and read");
  check(
    s.status.startsWith("3 bedrooms"),
    `plan showed 2 bedrooms, declared 3 → "${s.status}"`,
  );
  check(
    notes.some((n) => /Not found on the floor plan/.test(n)),
    `missing bedroom flagged: ${notes.join("; ")}`,
  );
  const living = await page
    .locator("article", { hasText: /living/i })
    .first()
    .textContent();
  log("living room card:", living?.replace(/Rename.*/, ""));
  await page.screenshot({
    path: `${OUT}02-rooms-after-plan.png`,
    fullPage: true,
  });
} catch (e) {
  fail(e.message.split("\n")[0]);
  await page
    .screenshot({ path: `${OUT}error.png`, fullPage: true })
    .catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
