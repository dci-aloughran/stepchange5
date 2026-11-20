// The whole buyer journey as a user would do it: home →
// rooms → needs → accessibility → keep → budget → review → plan → brief →
// layout → products → whole-home budget. (Concept images are covered by
// plan.e2e.mjs and skipped here to keep AI cost down.)
import { mkdirSync } from "node:fs";
import { serverSnapshot } from "./lib/journey.mjs";
import { APP, reporter, startSession } from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
const session = await startSession({ viewport: { width: 390, height: 844 } });
const { page } = session;
const shot = (name) => page.screenshot({ path: `${OUT}full-${name}.png`, fullPage: true });
const visible = (loc, timeout = 15000) => loc.waitFor({ timeout }).then(() => true, () => false);
const cont = async (next) => {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(`**/journey/${next}`);
};

try {
  // Sign in up front (a returning user), starting from a clean device.
  await page.goto(`${APP}/journey/home`);
  await page.evaluate(() => localStorage.clear());
  await session.signIn();
  await page.goto(`${APP}/journey/home`);

  // 1. Home: details entered by hand.
  await page.getByRole("button", { name: "Buying a home" }).click();
  await page.getByRole("button", { name: "House", exact: true }).click();
  check((await page.getByLabel(/Listing URL/).count()) === 0 && (await page.getByText("Bring in the listing").count()) === 0, "no listing link or listing preview on the home step");
  await page.getByLabel("Bedrooms").fill("3");
  await page.getByLabel("Bathrooms").fill("2");
  await page.getByLabel("Floor area (m²)").fill("93");
  await page.getByLabel("Price (£)").fill("325,000");
  await page.getByLabel("Address or name").fill("E2E Full Journey House");
  await shot("01-home");
  await cont("rooms");

  // 2. Rooms: one per declared bedroom/bathroom; measure the living room.
  await page.locator("[role=status]").first().waitFor();
  const status = await page.locator("[role=status]").first().textContent();
  check(/^3 bedrooms · 2 bathrooms/.test(status ?? ""), `rooms status: "${status}"`);
  // Measure the living room in the room editor.
  const livingCard = page.locator("article", { has: page.getByRole("heading", { name: "Living room" }) });
  await livingCard.getByRole("button", { name: "Edit" }).click();
  await livingCard.getByLabel("Width (m)").fill("4.6");
  await livingCard.getByLabel("Length (m)").fill("3.8");
  await livingCard.getByRole("button", { name: "Save room" }).click();
  check((await livingCard.textContent()).includes("4.6 × 3.8 m"), "living room measured 4.6 × 3.8 m");
  await shot("02-rooms");
  await page.getByRole("button", { name: "Use these rooms" }).click();
  await page.waitForURL("**/journey/needs");

  // 3. Household.
  await page.getByRole("button", { name: "+ Adult" }).click();
  await page.getByRole("button", { name: "+ Adult" }).click();
  await page.getByRole("button", { name: "+ Child" }).click();
  await page.locator("li", { has: page.getByRole("heading", { name: "Child 1" }) }).getByLabel("On the way").check();
  await page.getByRole("button", { name: "+ Visitor" }).click();
  await page.locator("li", { has: page.getByRole("heading", { name: "Visitor 1" }) }).getByLabel("Called (optional)").fill("Mum");
  await cont("access");

  // 4. Accessibility: confirmed wheelchair turning circle in the living room.
  await page.getByRole("button", { name: "+ Add an accessibility need" }).click();
  const need = page.getByRole("article", { name: "Need 1" });
  await need.getByLabel("What to plan for").selectOption("turning_area");
  await need.getByRole("button", { name: "A room" }).click();
  const roomSelect = need.getByLabel("Room", { exact: true });
  const livingLabel = await roomSelect.evaluate((el) => [...el.options].find((o) => /living/i.test(o.text))?.text);
  await roomSelect.selectOption({ label: livingLabel });
  await need.getByLabel("Turning circle diameter (cm)").fill("150");
  await need.getByLabel("Confirmed — treat as a hard layout rule").check();
  await cont("style");
  await cont("taste");
  await cont("keep");

  // 5. Keep: the sofa they're bringing.
  await page.getByRole("button", { name: "+ Add furniture you're keeping" }).click();
  const item = page.getByRole("article", { name: "Item 1" });
  await item.getByLabel("Item", { exact: true }).fill("Grey 3-seat sofa");
  await item.getByLabel("Category").selectOption("Sofa");
  await item.getByLabel("Room", { exact: true }).selectOption({ label: livingLabel });
  await item.getByLabel("Width (cm)").fill("210");
  await item.getByLabel("Depth (cm)").fill("95");
  await cont("budget");

  // 6. Budget → review → create plan.
  await page.getByLabel("Total furnishing budget (£)").fill("6000");
  await cont("review");
  const review = await page.locator("main").innerText();
  check(review.includes("£6,000") && review.includes("Turning space 150 cm"), "review shows budget and confirmed access rule");
  await shot("03-review");
  const create = page.getByRole("button", { name: "Create my plan", exact: true });
  await create.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Create my plan" && !b.disabled), null, { timeout: 30000 });
  await create.click();
  await page.waitForURL("**/plan", { timeout: 90000 });
  check(true, "Create my plan → /plan");

  // Server state is exactly what the user entered.
  const s = await serverSnapshot(page);
  check(s.homes.length === 1, `one home on the server (${s.homes.length})`);
  check(s.home?.listing?.pricePence === 32_500_000 && s.home?.listing?.bedrooms === 3, `home details saved ${JSON.stringify(s.home?.listing)}`);
  check(s.rooms.filter((x) => x.roomType === "bedroom").length === 3 && s.rooms.every((x) => x.reviewedAt), `3 bedrooms, all ${s.rooms.length} rooms reviewed`);
  const living = s.rooms.find((x) => /living/i.test(x.name));
  check(living?.roomType === "living_room" && living?.widthCm === 460 && living?.lengthCm === 380, `living room stored with its size (${living?.widthCm}×${living?.lengthCm})`);
  check(s.needs.length === 1 && s.needs[0].confirmed && s.household.budgetTotalPence === 600_000, "confirmed need + £6,000 budget saved");

  // 7. Plan the living room: brief → layout → products.
  const open = page.getByRole("link", { name: /Open Living room plan/i });
  check(await visible(open, 45000), "plan overview lists the living room");
  await shot("04-plan");
  await open.click();
  await page.waitForURL("**/plan/rooms/**");
  await page.getByRole("button", { name: "Create brief" }).click();
  log("creating brief…");
  const accept = page.getByRole("button", { name: "Accept brief" });
  check(await visible(accept, 150000), "brief created");
  const brief = await page.locator("#brief").innerText();
  check(/turning|wheelchair|150/i.test(brief), "brief reflects the confirmed turning space");
  check(/sofa/i.test(brief), "brief accounts for the kept sofa");
  await accept.click();
  check(await visible(page.getByText("Brief accepted."), 30000), "brief accepted");

  await page.getByRole("button", { name: "Plan the layout" }).click();
  log("planning layout…");
  check(await visible(page.getByTestId("layout-schematic"), 150000), "to-scale layout drawn");
  const verification = await page.getByTestId("layout-verification").innerText();
  log("layout verification:", verification.replace(/\s+/g, " ").slice(0, 160));
  check(verification.length > 0, "layout verification shown");
  await shot("05-layout");

  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Find products" }).click();
  log("finding products…");
  await page.getByTestId("shop-status").waitFor({ timeout: 150000 });
  const products = await page.getByTestId("product-card").count();
  const unavailable = await page.getByTestId("catalogue-unavailable").count();
  check(products > 0 || unavailable > 0, `products: ${products} real products${unavailable ? " (catalogue unavailable shown)" : ""}`);
  await shot("06-shop");

  // 8. Whole-home budget.
  await page.getByRole("link", { name: "See whole-home budget" }).click();
  await page.waitForURL("**/plan/budget");
  const total = await page.getByTestId("budget-total").innerText();
  check(/£6,000/.test(total), `budget page: ${total.replace(/\s+/g, " ").slice(0, 120)}`);
  check((await page.getByTestId("shopping-list").locator("li").count()) > 0, "prioritised shopping list shown");
  await shot("07-budget");
} catch (e) {
  fail(e.message.split("\n")[0]);
  await shot("error").catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
