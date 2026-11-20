// Plan → shop → budget: brief, layout schematic, one concept, products,
// swap, price refresh + retailer hand-off, and the whole-home budget.
import { mkdirSync } from "node:fs";
import { apiClient, seedPlanHome } from "./lib/plan.mjs";
import { APP, reporter, startSession } from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
const session = await startSession();
const { page } = session;
const shot = (name) =>
  page.screenshot({ path: `${OUT}plan-${name}.png`, fullPage: true });
const visible = (locator, timeout) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );

try {
  // Signed out: the plan asks you to sign in.
  await page.goto(`${APP}/plan`);
  check(
    await visible(page.getByRole("button", { name: "Sign in" }), 20000),
    "signed out → sign-in prompt",
  );

  await session.signIn();
  const api = apiClient(session);
  const { room } = await seedPlanHome(api);
  log("seeded room", room.id, "reviewed:", Boolean(room.reviewedAt));

  // 1. Overview
  await page.goto(`${APP}/plan`);
  const openRoom = page.getByRole("link", { name: "Open Living room plan" });
  check(await visible(openRoom, 30000), "overview lists the living room");
  const card = page.locator("article", { hasText: "Living room" });
  check(
    (await card.textContent()).includes("Ready for a brief"),
    "room status: ready for a brief",
  );
  check(
    await visible(page.getByText("of your £6,000 budget"), 5000),
    "overview shows household budget",
  );
  await shot("01-overview");

  // 2a. Brief
  await openRoom.click();
  await page.waitForURL(`**/plan/rooms/${room.id}`);
  await page.getByRole("button", { name: "Create brief" }).click();
  log("creating brief…");
  const accept = page.getByRole("button", { name: "Accept brief" });
  check(await visible(accept, 150000), "brief created (draft)");
  const reqCount = await page.getByRole("button", { name: /^Edit / }).count();
  check(reqCount > 0, `brief has ${reqCount} furniture requirements`);
  check(
    (await page.locator("#brief").textContent()).includes(
      "Keep a 150cm turning space clear",
    ),
    "brief lists the confirmed turning space constraint",
  );
  await accept.click();
  check(
    await visible(page.getByText("Brief accepted."), 30000),
    "brief accepted",
  );

  // Edit one requirement (quantity + description).
  await page
    .getByRole("button", { name: /^Edit / })
    .first()
    .click();
  const form = page.locator("form[aria-label^='Edit ']");
  await form.getByLabel("Description").fill("E2E: edited requirement");
  await form.getByRole("button", { name: "Save requirement" }).click();
  check(
    await visible(page.getByText(/Saved changes to/), 30000),
    "requirement edited",
  );
  check(
    await visible(page.getByText("E2E: edited requirement"), 5000),
    "edited description shown",
  );
  await shot("02-brief");

  // 2b. Layout
  await page.getByRole("button", { name: "Plan the layout" }).click();
  log("planning layout…");
  const svg = page.getByTestId("layout-schematic");
  check(await visible(svg, 150000), "to-scale schematic rendered");
  const verification = await page
    .getByTestId("layout-verification")
    .textContent();
  check(
    /Verified fit|Fit not verified/.test(verification),
    `verification label: ${verification}`,
  );
  const rects = await svg.locator("rect").count();
  const desc = await svg.locator("desc").textContent();
  check(
    rects > 2 && desc.includes("4.6 metres wide"),
    `schematic has ${rects} shapes and a text alternative`,
  );
  check(
    (await page
      .getByRole("list", { name: "Placed items" })
      .locator("li")
      .count()) > 0,
    "placements listed as text",
  );
  await svg.scrollIntoViewIfNeeded();
  await shot("03-layout");

  // 2c. Concept (one image generation)
  await page.getByLabel("Vibe").fill("Calm and natural");
  await page.getByRole("button", { name: "Generate concept" }).click();
  log("generating concept…");
  const conceptCard = page.getByTestId("concept-card");
  const conceptOk = await visible(conceptCard, 240000);
  check(conceptOk, "concept generated");
  if (conceptOk) {
    const img = conceptCard.first().locator("img");
    check(await visible(img, 30000), "concept image shown");
    const loaded = await img
      .first()
      .evaluate((el) => el.complete && el.naturalWidth > 0)
      .catch(() => false);
    check(loaded, "concept image loaded from presigned URL");
    const disclosure = await conceptCard
      .first()
      .getByTestId("concept-disclosure")
      .textContent();
    check(
      /Indicative visual only/.test(disclosure),
      "concept disclosure visible",
    );
    check(
      (await conceptCard.first().textContent()).includes("Dimension basis"),
      "dimension basis visible",
    );
    await conceptCard.first().getByRole("button", { name: "Yes" }).click();
    check(
      await visible(
        conceptCard.first().locator("button[aria-pressed=true]", {
          hasText: "Yes",
        }),
        20000,
      ),
      "rated 'looks like my room'",
    );
  } else {
    log(
      "concept error:",
      await page
        .locator("#concept [role=alert]")
        .textContent()
        .catch(() => ""),
    );
  }
  await page.locator("#concept").scrollIntoViewIfNeeded();
  await shot("04-concept");

  // 2d. Shop
  await page.getByRole("button", { name: "Find products" }).click();
  log("finding products…");
  const shopStatus = page.getByTestId("shop-status");
  check(await visible(shopStatus, 150000), "product search finished");
  log("shop status:", await shopStatus.textContent());
  const products = page.getByTestId("product-card");
  const productCount = await products.count();
  const unavailable = await page.getByTestId("catalogue-unavailable").count();
  check(
    productCount > 0 || unavailable > 0,
    productCount > 0
      ? `${productCount} real products shown`
      : "catalogue-unavailable state clearly labelled",
  );
  if (unavailable > 0 && productCount === 0) {
    check(
      (await page.locator("#shop").textContent()).includes("Estimate"),
      "requirement-only estimates labelled as estimates",
    );
  }
  if (productCount > 0) {
    const first = products.first();
    check(
      (await first.textContent()).includes("via Shopify Catalog"),
      "retailer attribution shown",
    );
    // Swap the first product for a cheaper one.
    await first.getByText("Swap…").click();
    await first.getByRole("button", { name: "£ Cheaper" }).click();
    const swapped = await visible(
      page.getByTestId("shop-status").filter({
        hasText: /Swapped to|unchanged|No suitable|unavailable/,
      }),
      90000,
    );
    check(swapped, `swap: ${await shopStatus.textContent()}`);

    // Check price & buy: intercept the retailer tab instead of visiting it.
    const popupPromise = page.waitForEvent("popup", { timeout: 15000 });
    await products
      .first()
      .getByRole("button", { name: /Check price and buy/ })
      .click();
    const popup = await popupPromise;
    const seen = [];
    await popup.route("**/*", (route) => {
      seen.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<p>retailer stub</p>",
      });
    });
    const deadline = Date.now() + 60000;
    while (!seen.some((u) => /^https?:/.test(u)) && Date.now() < deadline) {
      if (popup.isClosed()) break;
      await page.waitForTimeout(250);
    }
    const url = seen.find((u) => /^https?:/.test(u));
    log(
      "hand-off URL:",
      url ?? "(none)",
      "| status:",
      await shopStatus.textContent(),
    );
    check(
      url != null &&
        !url.startsWith(APP) &&
        !/localhost/.test(new URL(url).host),
      `refresh → retailer tab opened (${url ? new URL(url).host : "none"})`,
    );
    if (!popup.isClosed()) await popup.close();
  }
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await shot("05-shop");

  // 3. Budget
  await page.getByRole("link", { name: "See whole-home budget" }).click();
  await page.waitForURL("**/plan/budget");
  const total = page.getByTestId("budget-total");
  check(await visible(total, 30000), "budget page rendered");
  const totalText = await total.textContent();
  check(
    /£[\d,]+/.test(totalText) && totalText.includes("£6,000"),
    `whole-home total vs budget: ${totalText.replace(/\s+/g, " ").slice(0, 160)}`,
  );
  check(
    /Within budget|At risk|Over budget/.test(totalText),
    "budget status shown",
  );
  check(
    (await page.getByTestId("budget-room").count()) === 1,
    "per-room totals shown",
  );
  check(
    (await page.getByTestId("shopping-list").locator("li").count()) > 0,
    "prioritised shopping list shown",
  );
  await shot("06-budget");

  // Overview reflects progress.
  await page.goto(`${APP}/plan`);
  await openRoom.waitFor({ timeout: 30000 });
  const statusText = await page
    .locator("article", { hasText: "Living room" })
    .textContent();
  check(
    /Products chosen|Layout verified|Layout needs attention/.test(statusText),
    "overview status updated after planning",
  );
} catch (e) {
  fail(e.message.split("\n")[0]);
  await page
    .screenshot({ path: `${OUT}plan-error.png`, fullPage: true })
    .catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
