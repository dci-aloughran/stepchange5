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
const SHOTS = process.env.DEMO_SHOTS === "1";
let offscreen = 0;

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
        // Let the end of the page scroll clear of the caption bar.
        document.body.style.paddingBottom = "170px";
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

// Space kept clear at the bottom of the window for the caption bar.
const CAPTION_SPACE = 150;

// Smoothly scroll so an element sits in the visible area above the caption
// bar ("center" by default, or near the top with block "start"). Visually
// hidden inputs (file pickers) scroll their visible label/section instead.
async function reveal(locator, { block = "center" } = {}) {
  const handle = await locator
    .first()
    .elementHandle({ timeout: 10000 })
    .catch(() => null);
  if (!handle) return;
  await handle
    .evaluate(
      (el, { block, reserve }) => {
        const hidden = el.getBoundingClientRect().height < 4;
        const target = (hidden && el.closest("label, section")) || el;
        const r = target.getBoundingClientRect();
        const usable = window.innerHeight - reserve;
        const offset =
          block === "start" || r.height > usable
            ? 72
            : Math.max(16, (usable - r.height) / 2);
        window.scrollTo({
          top: Math.max(0, window.scrollY + r.top - offset),
          behavior: "smooth",
        });
      },
      { block, reserve: CAPTION_SPACE },
    )
    .catch(() => {});
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          let last = -1;
          let still = 0;
          const started = performance.now();
          const tick = () => {
            const y = window.scrollY;
            still = y === last ? still + 1 : 0;
            last = y;
            if (still >= 4 || performance.now() - started > 3000) resolve();
            else setTimeout(tick, 80);
          };
          setTimeout(tick, 120);
        }),
    )
    .catch(() => {});
  await page.waitForTimeout(250);
  // Check the element (or the top of a tall one) is actually on screen.
  const onScreen = await handle
    .evaluate((el, reserve) => {
      const hidden = el.getBoundingClientRect().height < 4;
      const target = (hidden && el.closest("label, section")) || el;
      const r = target.getBoundingClientRect();
      const usable = window.innerHeight - reserve;
      return (
        r.top >= 0 &&
        r.top < usable &&
        (r.bottom <= usable || r.height > usable * 0.6)
      );
    }, CAPTION_SPACE)
    .catch(() => true);
  if (!onScreen) {
    offscreen += 1;
    console.warn(
      `    ! not fully on screen: ${locator.toString().slice(0, 110)}`,
    );
  }
}

// Slowly scroll through a tall section so the audience sees all of it.
async function pan(locator, seconds, from) {
  await reveal(from ?? locator, { block: "start" });
  const handle = await locator
    .first()
    .elementHandle({ timeout: 10000 })
    .catch(() => null);
  if (!handle) return;
  const distance = await handle
    .evaluate((el, reserve) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, r.bottom - (window.innerHeight - reserve) + 16);
    }, CAPTION_SPACE)
    .catch(() => 0);
  if (distance <= 0) {
    await page.waitForTimeout(seconds * 1000);
    return;
  }
  await page.evaluate(
    ({ distance, ms }) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const t0 = performance.now();
        const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
        const frame = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, start + distance * ease(p));
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      }),
    { distance, ms: Math.max(2500, seconds * 1000) },
  );
}

// A titled moment: caption + terminal line, then either focus on one element
// and pause, or pan through a section.
async function moment(
  title,
  text,
  seconds = PAUSE_S,
  { focus, scan, from } = {},
) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}\n    ${text.replace(/<[^>]+>/g, "")}`);
  await caption(title, text);
  const shot = () =>
    SHOTS
      ? page
          .screenshot({
            path: new URL(
              `./output/demo-${String(stepNo).padStart(2, "0")}.png`,
              import.meta.url,
            ).pathname,
          })
          .catch(() => {})
      : null;
  if (scan) {
    await page.waitForTimeout(900);
    await pan(scan, Math.max(3, seconds), from);
    await shot();
    if (MANUAL) await hold();
    else await page.waitForTimeout(1200);
    return;
  }
  if (focus) await reveal(focus);
  await shot();
  await hold(seconds);
}

// Bring an element on screen and briefly outline it before using it.
async function spotlight(locator) {
  await reveal(locator);
  await locator
    .first()
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

async function select(locator, option) {
  await spotlight(locator);
  await locator.selectOption(option);
}

async function upload(input, files) {
  await reveal(input);
  await input.setInputFiles(files);
}

async function cont(next) {
  await click(page.getByRole("button", { name: "Continue", exact: true }));
  await page.waitForURL(`**/journey/${next}`);
  await page.waitForTimeout(400);
}

// Show a "working" caption while an AI step runs, then bring the result on
// screen.
async function waitWithCaption(locator, title, text, timeout = 180000) {
  await caption(title, text, { busy: true });
  console.log(`    … ${text.replace(/<[^>]+>/g, "")}`);
  await locator.first().waitFor({ timeout });
  await reveal(locator);
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
    PAUSE_S,
    { focus: page.getByLabel("Bedrooms") },
  );
  await cont("rooms");

  // 2. Rooms + floor plan
  await page.locator("[role=status]").first().waitFor();
  await moment(
    "2 · Rooms",
    "A 3-bed house gets exactly three bedrooms. Sizes start as <b>unknown</b> — we never invent measurements.",
    PAUSE_S + 2,
    { scan: page.locator("main"), from: page.locator("[role=status]").first() },
  );
  const planInput = page.locator("input[type=file]").first();
  await planInput.waitFor({ state: "attached", timeout: 20000 });
  await reveal(planInput);
  await caption(
    "2 · Floor plan",
    "Now they upload the agent's floor plan (this one only shows two bedrooms)…",
  );
  await hold(3);
  await upload(planInput, {
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
    PAUSE_S + 4,
    { scan: page.locator("main"), from: page.locator("[role=status]").first() },
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
    PAUSE_S,
    {
      focus: page.locator("li", {
        has: page.getByRole("heading", { name: "Visitor 1" }),
      }),
    },
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
  await select(need.getByLabel("What to plan for"), "turning_area");
  await click(need.getByRole("button", { name: "A room" }));
  const roomSelect = need.getByLabel("Room", { exact: true });
  const livingLabel = await roomSelect.evaluate(
    (el) => [...el.options].find((o) => /living|lounge/i.test(o.text))?.text,
  );
  await select(roomSelect, { label: livingLabel });
  await type(need.getByLabel("Turning circle diameter (cm)"), "150");
  await click(need.getByLabel("Confirmed — treat as a hard layout rule"));
  await moment(
    "4 · Accessibility",
    "A confirmed 150 cm turning circle in the living room. Layouts must keep it clear.",
    PAUSE_S,
    { focus: need },
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
  await upload(inspoInput, [
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
  await moment(
    "5 · Style",
    "Warm oak: love. Glossy chrome: not for us.",
    PAUSE_S,
    {
      focus: page.getByRole("listitem", { name: "Photo 2" }),
    },
  );
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
    PAUSE_S + 5,
    {
      scan: page.locator("main"),
      from: page.getByRole("heading", { name: "What you're drawn to" }),
    },
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
  await select(item.getByLabel("Category"), "Sofa");
  await select(item.getByLabel("Room", { exact: true }), {
    label: livingLabel,
  });
  await type(item.getByLabel("Width (cm)"), "210");
  await type(item.getByLabel("Depth (cm)"), "95");
  await moment(
    "6 · Keep & find",
    "Their 210 cm sofa is kept — the plan works around it instead of selling them a new one.",
    3,
    { focus: item },
  );
  await cont("budget");

  // 7. Budget
  await type(page.getByLabel("Total furnishing budget (£)"), "6000");
  await click(page.getByRole("button", { name: "Child-friendly" }));
  await moment(
    "7 · Budget",
    "A whole-home budget of £6,000 keeps every room honest.",
    3,
    { focus: page.getByLabel("Total furnishing budget (£)") },
  );
  await cont("review");

  // 8. Review → create plan
  await moment(
    "8 · Review",
    "The whole picture — home, household, access, style, what they're keeping and budget.",
    PAUSE_S + 5,
    { scan: page.locator("main") },
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
    PAUSE_S + 4,
    { scan: page.locator("main") },
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
  await moment(
    "10 · Functional brief",
    "It keeps the 150 cm turning space, plans around the sofa they're keeping, and sizes furniture to the room.",
    PAUSE_S + 6,
    { scan: page.locator("#brief") },
  );
  await click(page.getByRole("button", { name: "Accept brief" }));
  await page.getByText("Brief accepted.").waitFor({ timeout: 30000 });

  await click(page.getByRole("button", { name: "Plan the layout" }));
  await waitWithCaption(
    page.getByTestId("layout-schematic"),
    "11 · Layout",
    "A feasible layout, checked by rules — not just AI — against the room, doors and the turning circle.",
  );
  await moment(
    "11 · Does it fit?",
    "A to-scale plan: shaded zones must stay clear. “Verified” only appears when the measurements support it.",
    PAUSE_S + 4,
    { focus: page.getByTestId("layout-schematic") },
  );
  await moment(
    "11 · Verified, with reasons",
    "Fit and access are only marked verified when confirmed measurements back them up.",
    3,
    { focus: page.getByTestId("layout-verification") },
  );

  if (!SKIP_IMAGE) {
    await type(page.getByLabel("Vibe"), "Warm contemporary, natural oak");
    await click(page.getByRole("button", { name: "Generate concept" }));
    await waitWithCaption(
      page.getByTestId("concept-card").first().locator("img"),
      "12 · Visual concept",
      "Only now do we style it — grounded in the confirmed layout. (This takes up to a minute.)",
      240000,
    );
    await moment(
      "12 · How could it feel?",
      "An indicative image, clearly labelled — it never implies exact fit or structural changes.",
      PAUSE_S + 4,
      { scan: page.getByTestId("concept-card").first() },
    );
  }

  await click(page.getByRole("button", { name: "Find products" }));
  await waitWithCaption(
    page.getByTestId("shop-status"),
    "13 · Shop the room",
    "Real products from participating Shopify retailers, matched to each requirement…",
  );
  await moment(
    "13 · Real products",
    "Ranked by fit, style, price and availability — <b>never</b> by commission. Swap any item, or check the price and buy.",
    PAUSE_S + 6,
    { scan: page.locator("#shop") },
  );

  // 10. Budget
  await click(page.getByRole("link", { name: "See whole-home budget" }));
  await page.waitForURL("**/plan/budget");
  await page.getByTestId("budget-total").waitFor();
  await moment(
    "14 · Whole-home budget",
    "Live prices vs. estimates, room by room, and a prioritised shopping list.",
    PAUSE_S + 5,
    { scan: page.locator("main") },
  );

  // 11. Account & privacy
  await page.goto(`${APP}/account`);
  await moment(
    "15 · Privacy by design",
    "Export or delete everything, and AI-training consent is off unless they opt in.",
    PAUSE_S + 2,
    { scan: page.locator("main") },
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
  if (offscreen)
    console.warn(`\n${offscreen} action(s) were not fully on screen.`);
  await session.close((...a) => console.log("   ", ...a));
  rl?.close();
}
