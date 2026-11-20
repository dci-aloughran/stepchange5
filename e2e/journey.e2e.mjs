// Whole journey: structured answers through the UI while signed out, sign in,
// "Create my plan", then check the server has everything exactly once and a
// fresh device restores the answers (MB-005).
import { mkdirSync } from "node:fs";
import { freshSignedInPage, serverSnapshot } from "./lib/journey.mjs";
import { APP, reporter, startSession } from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const r = reporter();
const { log, check, fail } = r;
const session = await startSession({ viewport: VIEWPORT });
const { page } = session;

const shot = (name, p = page) =>
  p.screenshot({ path: `${OUT}journey-${name}.png`, fullPage: true });
const cont = async (next) => {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(`**/journey/${next}`);
};

try {
  await page.goto(`${APP}/journey/home`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 01 Home
  await page.getByRole("button", { name: "Buying a home" }).click();
  await page.getByRole("button", { name: "House", exact: true }).click();
  await page.getByLabel("Address or name").fill("E2E Journey House");
  await page.getByLabel("Bedrooms").fill("3");
  await page.getByLabel("Bathrooms").fill("1");
  await page.getByLabel("Floor area (m²)").fill("92");
  await page.getByLabel("Price (£)").fill("350,000");
  await cont("rooms");

  // 01 Rooms
  await page.locator("[role=status]").first().waitFor();
  const roomStatus = await page.locator("[role=status]").first().textContent();
  check(/^3 bedrooms/.test(roomStatus ?? ""), `rooms: "${roomStatus}"`);
  await page.getByRole("button", { name: "Use these rooms" }).click();
  await page.waitForURL("**/journey/needs");

  // 02 Household: 2 adults + baby on the way + Mum visits
  await page.getByRole("button", { name: "+ Adult" }).click();
  await page.getByRole("button", { name: "+ Adult" }).click();
  await page.getByRole("button", { name: "+ Child" }).click();
  const child = page.locator("li", {
    has: page.getByRole("heading", { name: "Child 1" }),
  });
  await child.getByLabel("On the way").check();
  await page.getByRole("button", { name: "+ Visitor" }).click();
  const visitor = page.locator("li", {
    has: page.getByRole("heading", { name: "Visitor 1" }),
  });
  await visitor.getByLabel("Called (optional)").fill("Mum");
  await page.getByRole("button", { name: "2 days a week" }).click();
  await page
    .getByRole("group", { name: "Eating together at a table" })
    .getByRole("button", { name: "Daily" })
    .click();
  await page.getByLabel("Child safety").check();
  await shot("02-needs");
  await cont("access");

  // 02 Accessibility: confirmed 150 cm turning circle in the living room
  await page
    .getByRole("button", { name: "+ Add an accessibility need" })
    .click();
  const need = page.getByRole("article", { name: "Need 1" });
  await need.getByLabel("What to plan for").selectOption("turning_area");
  await need.getByRole("button", { name: "A room" }).click();
  await need
    .getByLabel("Room", { exact: true })
    .selectOption({ label: "Living room" });
  await need.getByLabel("Turning circle diameter (cm)").fill("150");
  await need.getByLabel("Confirmed — treat as a hard layout rule").check();
  await need
    .getByLabel("Notes (optional)")
    .fill("Mum visits with a wheelchair");
  check(
    (await need.getByRole("status").count()) === 0,
    "accessibility need is complete",
  );
  await shot("03-access");
  await cont("style");

  // 03 Style + taste (built separately; just move on)
  await cont("taste");
  await cont("keep");

  // 04 Keep: a 210 cm sofa in the living room
  await page
    .getByRole("button", { name: "+ Add furniture you're keeping" })
    .click();
  const item = page.getByRole("article", { name: "Item 1" });
  await item.getByLabel("Item", { exact: true }).fill("Grey 3-seat sofa");
  await item.getByLabel("Category").selectOption("Sofa");
  await item
    .getByLabel("Room", { exact: true })
    .selectOption({ label: "Living room" });
  await item.getByLabel("Width (cm)").fill("210");
  await item.getByLabel("Depth (cm)").fill("95");
  await cont("budget");

  // 05 Budget: £6,000
  await page.getByLabel("Total furnishing budget (£)").fill("6000");
  await page.getByRole("button", { name: "Child-friendly" }).click();
  check(
    (await page.getByLabel("Total furnishing budget (£)").inputValue()) ===
      "6,000",
    "budget formatted as 6,000",
  );
  await cont("review");

  // 06 Review
  const review = await page.locator("main").innerText();
  check(
    review.includes("Two adults. A baby on the way. One regular visitor."),
    "review: household summary",
  );
  check(
    review.includes("Turning space 150 cm · Living room · confirmed rule"),
    "review: confirmed accessibility rule",
  );
  check(
    review.includes("Grey 3-seat sofa · 210 × 95 cm · Living room"),
    "review: sofa",
  );
  check(review.includes("£6,000"), "review: budget");
  check(review.includes("all checked by you"), "review: rooms checked");
  const signInCta = page.getByRole("button", {
    name: "Sign in to create my plan",
  });
  check(
    await signInCta.waitFor({ timeout: 15000 }).then(
      () => true,
      () => false,
    ),
    "signed out → 'Sign in to create my plan'",
  );
  await shot("06-review-signed-out");

  // Sign in, then create the plan.
  await session.signIn();
  const create = page.getByRole("button", {
    name: "Create my plan",
    exact: true,
  });
  await create.waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Create my plan" && !b.disabled,
      ),
    null,
    { timeout: 30000 },
  );
  await create.click();
  await page.waitForURL("**/plan", { timeout: 90000 });
  check(true, "Create my plan → /plan");
  const planRooms = page.locator("section", {
    has: page.getByRole("heading", { name: "Rooms in this plan" }),
  });
  const planShown = await planRooms
    .getByText("Main bedroom")
    .first()
    .waitFor({ timeout: 45000 })
    .then(
      () => true,
      () => false,
    );
  const planText = planShown ? await planRooms.innerText() : "";
  check(
    planShown &&
      ["Living room", "Main bedroom", "Bedroom 2", "Bedroom 3"].every((n) =>
        planText.includes(n),
      ),
    "/plan lists the synced rooms",
  );
  await shot("08-plan");

  // Server state: everything exactly once.
  const verify = async (label, p) => {
    const s = await serverSnapshot(p);
    const living = s.rooms.find((x) => x.roomType === "living_room");
    const bedrooms = s.rooms.filter((x) => x.roomType === "bedroom");
    check(
      s.homes.length === 1,
      `${label}: exactly one home (${s.homes.length})`,
    );
    check(
      s.home?.name === "E2E Journey House" &&
        s.home?.listing?.bedrooms === 3 &&
        s.home?.listing?.pricePence === 35_000_000,
      `${label}: home details ${JSON.stringify(s.home?.listing)}`,
    );
    check(
      bedrooms.length === 3,
      `${label}: 3 bedrooms (${s.rooms.map((x) => x.name).join(", ")})`,
    );
    check(
      s.rooms.length > 0 && s.rooms.every((x) => x.reviewedAt),
      `${label}: all ${s.rooms.length} rooms reviewed`,
    );
    check(
      new Set(s.rooms.map((x) => x.name)).size === s.rooms.length,
      `${label}: no duplicate rooms`,
    );
    check(
      s.household.budgetTotalPence === 600_000,
      `${label}: budget ${s.household.budgetTotalPence}p`,
    );
    check(
      s.household.lifestyle?.wfhDaysPerWeek === 2 &&
        s.household.practicalNeeds?.childSafety === true,
      `${label}: lifestyle + practical needs`,
    );
    const roles = s.persons
      .map((x) => x.role)
      .sort()
      .join(",");
    check(
      s.persons.length === 4 && roles === "adult,adult,child,regular_visitor",
      `${label}: persons ${roles}`,
    );
    check(
      s.persons.some(
        (x) =>
          x.role === "child" &&
          x.ageYears === 0 &&
          /on the way/i.test(x.routines?.notes ?? ""),
      ) && s.persons.some((x) => x.label === "Mum"),
      `${label}: baby on the way + Mum`,
    );
    check(
      s.needs.length === 1 &&
        s.needs[0].needType === "turning_area" &&
        s.needs[0].confirmed === true &&
        s.needs[0].params?.diameterCm === 150 &&
        s.needs[0].scope === "room" &&
        s.needs[0].roomId === living?.id,
      `${label}: one confirmed 150 cm turning need in the living room`,
    );
    check(
      s.possessions.length === 1 &&
        s.possessions[0].widthCm === 210 &&
        s.possessions[0].keep === true &&
        s.possessions[0].roomId === living?.id,
      `${label}: one 210 cm sofa kept in the living room`,
    );
    check(
      s.me.journeyState?.homeId === s.home?.id &&
        s.me.journeyState?.draft?.version === 1,
      `${label}: journeyState has homeId + draft`,
    );
    return s;
  };
  const first = await verify("after create", page);
  const localHome = await page.evaluate(
    () => JSON.parse(localStorage.getItem("deloitful.journey") ?? "{}").homeId,
  );
  check(localHome === first.home?.id, "local homeId matches server home");

  // A fresh device with empty storage restores the answers.
  const fresh = await freshSignedInPage(session, VIEWPORT);
  const p2 = fresh.page;
  await p2.goto(`${APP}/journey/home`);
  await p2
    .getByText("We've restored your answers from your account")
    .waitFor({ timeout: 30000 });
  check(true, "fresh device: restore banner shown");
  check(
    (await p2.getByLabel("Address or name").inputValue()) ===
      "E2E Journey House",
    "fresh device: address restored",
  );
  await p2.goto(`${APP}/journey/budget`);
  check(
    (await p2.getByLabel("Total furnishing budget (£)").inputValue()) ===
      "6,000",
    "fresh device: budget restored",
  );
  await p2.goto(`${APP}/journey/review`);
  const review2 = await p2.locator("main").innerText();
  check(
    review2.includes("Grey 3-seat sofa") &&
      review2.includes("Turning space 150 cm · Living room · confirmed rule") &&
      review2.includes("A baby on the way"),
    "fresh device: review rebuilt from restored answers",
  );
  await shot("07-fresh-device-review", p2);
  // Let any automatic save from the restored device run, then re-check.
  await p2.waitForTimeout(5000);
  await verify("after restore", p2);
  await fresh.context.close();
} catch (e) {
  fail(e.message.split("\n")[0]);
  await shot("error").catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
