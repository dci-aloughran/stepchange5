// Live demo: drives the real app in a visible Chrome window, with a caption
// bar explaining each step and pauses at the key moments.
//
//   cd e2e && pnpm demo                        # timed pauses (default 5s)
//   DEMO_MODE=manual pnpm demo                 # press Enter to advance
//   DEMO_PAUSE=8 pnpm demo                     # longer timed pauses
//   DEMO_SKIP_IMAGE=1 pnpm demo                # skip the AI room image
//   E2E_APP=http://localhost:3000 pnpm demo    # against a local app
//   DEMO_HEADLESS=1 DEMO_PAUSE=0.5 pnpm demo   # quick unattended check
//
// Uses a throwaway test account that is deleted at the end (with all its data).

import { createInterface } from "node:readline/promises";

process.env.E2E_APP ??= "https://stepchange5.vercel.app";
const { APP, startSession, sampleFloorPlanPng } = await import(
  "./lib/session.mjs"
);
const { warmOakRoomJpeg, glossyChromeRoomJpeg } = await import(
  "./lib/taste.mjs"
);

const MANUAL = process.env.DEMO_MODE === "manual";
const PAUSE_S = Number(process.env.DEMO_PAUSE ?? 5);
const SKIP_IMAGE = process.env.DEMO_SKIP_IMAGE === "1";
const TYPE_DELAY = 55;

const rl = MANUAL
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;
const session = await startSession({
  headed: process.env.DEMO_HEADLESS !== "1",
  slowMo: 120,
  viewport: { width: 430, height: 880 },
  deviceScaleFactor: 2,
  windowSize: { width: 470, height: 1010 },
});
const { page } = session;

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

let stepNo = 0;

// Caption bar pinned to the bottom of the page. Re-applied after navigation.
async function caption(title, text, { busy = false } = {}) {
  await page
    .evaluate(
      ({ title, text, busy }) => {
        let el = document.getElementById("demo-caption");
        if (!el) {
          el = document.createElement("div");
          el.id = "demo-caption";
          el.setAttribute("aria-hidden", "true");
          Object.assign(el.style, {
            position: "fixed",
            left: "10px",
            right: "10px",
            bottom: "10px",
            zIndex: "2147483647",
            padding: "14px 16px",
            borderRadius: "18px",
            background: "rgba(10,16,13,0.94)",
            border: "1px solid rgba(139,195,74,0.6)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            color: "#f2ede4",
            font: "15px/1.4 system-ui, sans-serif",
            pointerEvents: "none",
          });
          document.body.appendChild(el);
        }
        el.innerHTML = `<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8bc34a;margin-bottom:4px">${busy ? "⏳ " : ""}${title}</div><div>${text}</div>`;
      },
      { title, text, busy },
    )
    .catch(() => {});
}

async function hold(seconds = PAUSE_S) {
  if (MANUAL) {
    await rl.question("   ↵ Enter to continue… ");
  } else {
    await page.waitForTimeout(seconds * 1000);
  }
}

// A titled moment in the demo: caption + terminal line + pause.
async function moment(title, text, seconds) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}\n    ${text.replace(/<[^>]+>/g, "")}`);
  await caption(title, text);
  await hold(seconds);
}

// Brief visual emphasis on an element before interacting with it.
async function spotlight(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator
    .evaluate((el) => {
      const prev = el.style.outline;
      el.style.outline = "3px solid #8bc34a";
      el.style.outlineOffset = "3px";
      setTimeout(() => {
        el.style.outline = prev;
      }, 1400);
    })
    .catch(() => {});
}

async function click(locator) {
  await spotlight(locator);
  await locator.click();
}

async function type(locator, text) {
  await spotlight(locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
}

async function cont(next) {
  await click(page.getByRole("button", { name: "Continue", exact: true }));
  await page.waitForURL(`**/journey/${next}`);
}

async function waitWithCaption(locator, title, text, timeout = 180000) {
  await caption(title, text, { busy: true });
  console.log(`    … ${text.replace(/<[^>]+>/g, "")}`);
  await locator.waitFor({ timeout });
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

try {
  console.log(
    `Deloitful.Home live demo → ${APP}${MANUAL ? " (manual: press Enter to advance)" : ` (pauses ${PAUSE_S}s)`}`,
  );
  await page.goto(`${APP}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await moment(
    "Deloitful.Home",
    "Can this home work beautifully and practically for <b>our</b> household? Needs first, rooms next, products last.",
  );

  // Sign in quietly with the demo account so uploads and AI steps work.
  await caption(
    "Signing in",
    "Using a temporary demo account (deleted at the end).",
    { busy: true },
  );
  await session.signIn();
  await page.goto(`${APP}/journey/home`);

  // 1. Home
  await moment(
    "1 · The home",
    "A family is thinking of buying a 3-bedroom house. They enter the basics by hand.",
    3,
  );
  await click(page.getByRole("button", { name: "Buying a home" }));
  await click(page.getByRole("button", { name: "House", exact: true }));
  await type(page.getByLabel("Address or name"), "14 Willow Road");
  await type(page.getByLabel("Bedrooms"), "3");
  await type(page.getByLabel("Bathrooms"), "1");
  await type(page.getByLabel("Floor area (m²)"), "92");
  await type(page.getByLabel("Price (£)"), "350,000");
  await moment(
    "1 · The home",
    "Bedrooms and bathrooms drive the room list on the next step.",
  );
  await cont("rooms");

  // 2. Rooms + floor plan
  await page.locator("[role=status]").first().waitFor();
  await moment(
    "2 · Rooms",
    "A 3-bed house gets exactly three bedrooms. Sizes start as <b>unknown</b> — we never invent measurements.",
  );
  const planInput = page.locator("input[type=file]").first();
  await planInput.waitFor({ state: "attached", timeout: 20000 });
  await caption(
    "2 · Floor plan",
    "Now they upload the agent's floor plan (this one only shows two bedrooms)…",
  );
  await hold(3);
  await planInput.setInputFiles({
    name: "floor-plan.png",
    mimeType: "image/png",
    buffer: await sampleFloorPlanPng(),
  });
  await waitWithCaption(
    page.getByText(/Found \d+ rooms?/),
    "2 · Reading the floor plan",
    "The file is checked for safety, then AI reads the room names and <b>printed</b> sizes only.",
  );
  await moment(
    "2 · Floor plan read",
    "Rooms and printed sizes came from the plan. The third bedroom wasn't on it, so it's added and flagged <b>“add its measurements”</b>.",
    PAUSE_S + 3,
  );
  await click(page.getByRole("button", { name: "Use these rooms" }));
  await page.waitForURL("**/journey/needs");

  // 3. Household
  await moment(
    "3 · Household",
    "Who lives here, who's on the way, and who visits — no names needed.",
    3,
  );
  await click(page.getByRole("button", { name: "+ Adult" }));
  await click(page.getByRole("button", { name: "+ Adult" }));
  await click(page.getByRole("button", { name: "+ Child" }));
  await click(
    page
      .locator("li", { has: page.getByRole("heading", { name: "Child 1" }) })
      .getByLabel("On the way"),
  );
  await click(page.getByRole("button", { name: "+ Visitor" }));
  await type(
    page
      .locator("li", { has: page.getByRole("heading", { name: "Visitor 1" }) })
      .getByLabel("Called (optional)"),
    "Mum",
  );
  await click(page.getByRole("button", { name: "2 days a week" }));
  await moment(
    "3 · Household",
    "Two adults, a baby on the way, and Mum visits weekly to help.",
  );
  await cont("access");

  // 4. Accessibility
  await moment(
    "4 · Accessibility",
    "Mum uses a wheelchair. Accessibility is a <b>hard constraint</b>, not a style preference.",
    3,
  );
  await click(
    page.getByRole("button", { name: "+ Add an accessibility need" }),
  );
  const need = page.getByRole("article", { name: "Need 1" });
  await need.getByLabel("What to plan for").selectOption("turning_area");
  await click(need.getByRole("button", { name: "A room" }));
  const roomSelect = need.getByLabel("Room", { exact: true });
  const livingLabel = await roomSelect.evaluate(
    (el) => [...el.options].find((o) => /living|lounge/i.test(o.text))?.text,
  );
  await roomSelect.selectOption({ label: livingLabel });
  await type(need.getByLabel("Turning circle diameter (cm)"), "150");
  await click(need.getByLabel("Confirmed — treat as a hard layout rule"));
  await moment(
    "4 · Accessibility",
    "A confirmed 150 cm turning circle in the living room. Layouts must keep it clear.",
  );
  await cont("style");

  // 5. Style + taste
  await moment(
    "5 · Style",
    "They share a couple of inspiration photos and say what they love and don't.",
    3,
  );
  const inspoInput = page.locator("input[type=file]").first();
  await inspoInput.waitFor({ state: "attached", timeout: 20000 });
  const [gloss, oak] = await Promise.all([
    glossyChromeRoomJpeg(),
    warmOakRoomJpeg(),
  ]);
  await inspoInput.setInputFiles([
    { name: "glossy-chrome.jpg", mimeType: "image/jpeg", buffer: gloss },
    { name: "warm-oak.jpg", mimeType: "image/jpeg", buffer: oak },
  ]);
  await waitWithCaption(
    page.getByText(/Added 2 photos/),
    "5 · Style",
    "Uploading inspiration photos…",
    90000,
  );
  await click(
    page
      .getByRole("listitem", { name: "Photo 2" })
      .getByRole("button", { name: "Love", exact: true }),
  );
  await click(
    page
      .getByRole("listitem", { name: "Photo 1" })
      .getByRole("button", { name: "Don't love" }),
  );
  await type(page.getByLabel("Colours you like"), "Sage green, warm white");
  await moment("5 · Style", "Warm oak: love. Glossy chrome: not for us.");
  await cont("taste");
  await click(page.getByRole("button", { name: "Interpret my taste" }));
  await waitWithCaption(
    page.getByRole("heading", { name: "What you're drawn to" }),
    "5 · Interpreting taste",
    "AI turns the inspiration into a richer, <b>editable</b> taste profile.",
  );
  await moment(
    "5 · Your taste",
    "Not just “Scandinavian” — specific materials, colours and forms, with dislikes too. The family can correct anything.",
    PAUSE_S + 3,
  );
  const looksLikeMe = page.getByRole("button", { name: "Looks like me" });
  if (await looksLikeMe.isVisible().catch(() => false))
    await click(looksLikeMe);
  await cont("keep");

  // 6. Keep
  await moment(
    "6 · Keep & find",
    "Furniture they're bringing is planned around first.",
    3,
  );
  await click(
    page.getByRole("button", { name: "+ Add furniture you're keeping" }),
  );
  const item = page.getByRole("article", { name: "Item 1" });
  await type(item.getByLabel("Item", { exact: true }), "Grey 3-seat sofa");
  await item.getByLabel("Category").selectOption("Sofa");
  await item
    .getByLabel("Room", { exact: true })
    .selectOption({ label: livingLabel });
  await type(item.getByLabel("Width (cm)"), "210");
  await type(item.getByLabel("Depth (cm)"), "95");
  await cont("budget");

  // 7. Budget
  await type(page.getByLabel("Total furnishing budget (£)"), "6000");
  await click(page.getByRole("button", { name: "Child-friendly" }));
  await moment(
    "7 · Budget",
    "A whole-home budget of £6,000 keeps every room honest.",
    3,
  );
  await cont("review");

  // 8. Review → create plan
  await moment(
    "8 · Review",
    "The whole picture — home, household, access, style, what they're keeping and budget.",
    PAUSE_S + 2,
  );
  const create = page.getByRole("button", {
    name: "Create my plan",
    exact: true,
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Create my plan" && !b.disabled,
      ),
    null,
    { timeout: 30000 },
  );
  await caption(
    "8 · Create my plan",
    "Everything is saved securely to their account…",
    { busy: true },
  );
  await click(create);
  await page.waitForURL("**/plan", { timeout: 90000 });
  const openLiving = page
    .getByRole("link", { name: /Open (Living|Lounge).* plan/i })
    .first();
  await openLiving.waitFor({ timeout: 45000 });
  await moment(
    "9 · The plan",
    "Every room with its status, warnings about missing measurements, and the budget so far.",
  );

  // 9. Living room: brief → layout → concept → products
  await click(openLiving);
  await page.waitForURL("**/plan/rooms/**");
  await click(page.getByRole("button", { name: "Create brief" }));
  await waitWithCaption(
    page.getByRole("button", { name: "Accept brief" }),
    "10 · Functional brief",
    "<b>Requirement first, product second.</b> AI drafts what this room needs for this household…",
  );
  await page.locator("#brief").scrollIntoViewIfNeeded();
  await moment(
    "10 · Functional brief",
    "It keeps the 150 cm turning space, plans around the sofa they're keeping, and sizes furniture to the room.",
    PAUSE_S + 4,
  );
  await click(page.getByRole("button", { name: "Accept brief" }));
  await page.getByText("Brief accepted.").waitFor({ timeout: 30000 });

  await click(page.getByRole("button", { name: "Plan the layout" }));
  await waitWithCaption(
    page.getByTestId("layout-schematic"),
    "11 · Layout",
    "A feasible layout, checked by rules — not just AI — against the room, doors and the turning circle.",
  );
  await page.getByTestId("layout-schematic").scrollIntoViewIfNeeded();
  await moment(
    "11 · Does it fit?",
    "A to-scale plan: shaded zones must stay clear. “Verified” only appears when the measurements support it.",
    PAUSE_S + 4,
  );

  if (!SKIP_IMAGE) {
    await page.locator("#concept").scrollIntoViewIfNeeded();
    await type(page.getByLabel("Vibe"), "Warm contemporary, natural oak");
    await click(page.getByRole("button", { name: "Generate concept" }));
    await waitWithCaption(
      page.getByTestId("concept-card").first().locator("img"),
      "12 · Visual concept",
      "Only now do we style it — grounded in the confirmed layout. (This takes up to a minute.)",
      240000,
    );
    await page.getByTestId("concept-card").first().scrollIntoViewIfNeeded();
    await moment(
      "12 · How could it feel?",
      "An indicative image, clearly labelled — it never implies exact fit or structural changes.",
      PAUSE_S + 4,
    );
  }

  await page.locator("#shop").scrollIntoViewIfNeeded();
  await click(page.getByRole("button", { name: "Find products" }));
  await waitWithCaption(
    page.getByTestId("shop-status"),
    "13 · Shop the room",
    "Real products from participating Shopify retailers, matched to each requirement…",
  );
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await moment(
    "13 · Real products",
    "Ranked by fit, style, price and availability — <b>never</b> by commission. Swap any item, or check the price and buy.",
    PAUSE_S + 4,
  );

  // 10. Budget
  await click(page.getByRole("link", { name: "See whole-home budget" }));
  await page.waitForURL("**/plan/budget");
  await page.getByTestId("budget-total").waitFor();
  await moment(
    "14 · Whole-home budget",
    "Live prices vs. estimates, room by room, and a prioritised shopping list.",
    PAUSE_S + 3,
  );

  // 11. Account & privacy
  await page.goto(`${APP}/account`);
  await moment(
    "15 · Privacy by design",
    "Export or delete everything, and AI-training consent is off unless they opt in.",
  );
  await moment(
    "Thank you",
    "Understand → Plan → Imagine → Refine → Buy. The demo account is now being deleted.",
    4,
  );
} catch (e) {
  console.error("\nDemo stopped:", e.message.split("\n")[0]);
  await caption("Demo paused", "Something went wrong — see the terminal.");
  await page
    .screenshot({
      path: new URL("./output/demo-error.png", import.meta.url).pathname,
      fullPage: true,
    })
    .catch(() => {});
  if (MANUAL) await rl.question("   ↵ Enter to clean up and close… ");
  else await page.waitForTimeout(5000);
} finally {
  await session.close((...a) => console.log("   ", ...a));
  rl?.close();
}
