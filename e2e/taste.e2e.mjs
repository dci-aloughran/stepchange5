// Taste journey (FR-07, FR-08): inspiration photos, reactions, links,
// AI taste interpretation (one real AI call) and user corrections.
//
// Uses the dev preview page by default; set E2E_TASTE_PATH to test the
// components where the journey renders them (e.g. /journey/style).
import { mkdirSync } from "node:fs";
import { APP, reporter, startSession } from "./lib/session.mjs";
import { api, glossyChromeRoomJpeg, warmOakRoomJpeg } from "./lib/taste.mjs";

const PATH = process.env.E2E_TASTE_PATH ?? "/taste-preview";
const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
const session = await startSession();
const { page } = session;

const ok = (p) =>
  p.then(
    () => true,
    () => false,
  );
const status = () =>
  page
    .locator("[aria-live=polite]")
    .allTextContents()
    .then((t) => t.join(" | "));
const likes = () => page.locator("section[aria-labelledby=taste-likes] li");
const avoids = () => page.locator("section[aria-labelledby=taste-avoids] li");

try {
  await page.goto(`${APP}${PATH}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Signed out: explanation + sign-in (uploads need an account, SE-001).
  check(
    (await ok(
      page
        .getByRole("heading", { name: "Sign in to add inspiration" })
        .waitFor({ timeout: 20000 }),
    )) &&
      (await page
        .getByRole("button", { name: "Sign in to continue" })
        .first()
        .isVisible()),
    "signed out → explanation and sign-in button",
  );

  await session.signIn();
  await page.goto(`${APP}${PATH}`);
  const input = page.locator("input[type=file]");
  await input.waitFor({ state: "attached", timeout: 20000 });
  check(true, "signed in → photo picker available");

  // Two photos in one multi-select; the newest appears first.
  const [gloss, oak] = await Promise.all([
    glossyChromeRoomJpeg(),
    warmOakRoomJpeg(),
  ]);
  await input.setInputFiles([
    { name: "glossy-chrome.jpg", mimeType: "image/jpeg", buffer: gloss },
    { name: "warm-oak.jpg", mimeType: "image/jpeg", buffer: oak },
  ]);
  log("uploading 2 photos…");
  await page
    .getByText(/Added 2 photos|couldn't|went wrong|failed/i)
    .first()
    .waitFor({ timeout: 90000 });
  const photo1 = page.getByRole("listitem", { name: "Photo 1" });
  const photo2 = page.getByRole("listitem", { name: "Photo 2" });
  check(
    (await photo1.count()) === 1 && (await photo2.count()) === 1,
    `two photos added → "${await status()}"`,
  );
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll("li img")];
      return imgs.length >= 2 && imgs.every((i) => i.naturalWidth > 0);
    },
    null,
    { timeout: 30000 },
  );
  check(true, "thumbnails load from short-lived image links");

  // Reactions + a note. Photos are numbered oldest first: 1 = glossy, 2 = oak.
  await photo2.getByRole("button", { name: "Love", exact: true }).click();
  await page.getByText("Marked as Love.").waitFor();
  await photo1.getByRole("button", { name: "Don't love" }).click();
  await page.getByText("Marked as Don't love.").waitFor();
  await photo2
    .getByLabel("Note (optional)")
    .fill("Love the warm oak floor and the sage sofa");
  await photo2.getByLabel("Note (optional)").blur();
  await page.getByText("Note saved.").waitFor();
  check(
    (await photo2
      .getByRole("button", { name: "Love", exact: true })
      .getAttribute("aria-pressed")) === "true" &&
      (await photo1
        .getByRole("button", { name: "Don't love" })
        .getAttribute("aria-pressed")) === "true",
    "marked Love / Don't love",
  );

  // Pinterest link: stored as a reference only (D-003).
  await page
    .getByLabel("Board or post link")
    .fill("pinterest.co.uk/example/warm-oak-living-rooms/");
  await page
    .getByLabel("What you like about it (optional)")
    .fill("Warm oak and linen living rooms");
  await page.getByRole("button", { name: "Save link" }).click();
  await page.getByText("Saved your Pinterest link as a reference.").waitFor();
  check(
    await page
      .getByRole("listitem", { name: "Pinterest link 1" })
      .getByText("reference only")
      .isVisible(),
    "Pinterest link saved and labelled reference only",
  );
  check(
    await page.getByText(/we don't open it, fetch it/i).isVisible(),
    "explains links are not fetched",
  );

  // Free text, brands, colours.
  await page
    .getByLabel("Words that describe what you like")
    .fill("Calm, warm and natural. Nothing shiny.");
  await page.getByLabel("Brands you like").fill("HAY, Habitat");
  await page.getByLabel("Colours you like").fill("Sage green, warm white");
  await page.getByLabel("Colours you like").blur();
  await page.screenshot({
    path: `${OUT}taste-01-inspiration.png`,
    fullPage: true,
  });

  let token = await session.token();
  const insp = await api(token, "/taste/inspiration");
  const items = insp.body?.items ?? [];
  log(
    "server inspiration:",
    items.map((i) => `${i.kind}:${i.reaction}${i.note ? ` "${i.note}"` : ""}`),
  );
  check(
    items.length === 3 &&
      items.filter((i) => i.kind === "image" && i.usableForDerivation)
        .length === 2 &&
      items.some(
        (i) => i.kind === "image" && i.reaction === "love" && i.note,
      ) &&
      items.some((i) => i.kind === "image" && i.reaction === "dislike") &&
      items.some(
        (i) => i.kind === "pinterest" && i.note && !i.uploadId && i.sourceUrl,
      ),
    "inspiration persisted on the server",
  );

  // Interpret taste (one real AI call).
  await page.getByRole("button", { name: "Interpret my taste" }).click();
  check(
    await ok(
      page
        .getByRole("heading", { name: "Interpreting your taste" })
        .waitFor({ timeout: 5000 }),
    ),
    "progress shown while interpreting",
  );
  log("interpreting taste (AI)…");
  await page
    .getByRole("heading", { name: "What you're drawn to" })
    // (Next's route announcer also has role=alert, so scope to main.)
    .or(page.locator("main [role=alert]"))
    .first()
    .waitFor({ timeout: 150000 });
  const likeCount = await likes().count();
  const avoidCount = await avoids().count();
  const likeTexts = await likes().allTextContents();
  const avoidTexts = await avoids().allTextContents();
  log("likes:", likeTexts.join(" | "));
  log("avoids:", avoidTexts.join(" | "));
  check(
    likeCount >= 2,
    `attributes rendered (${likeCount} likes, ${avoidCount} avoids)`,
  );
  check(
    likeTexts.some((t) => /Very sure|Fairly sure|Not so sure|A guess/.test(t)),
    "confidence shown in plain language",
  );
  check(
    await page.getByText(/AI interpretation\./).isVisible(),
    "AI disclosure shown",
  );
  check(
    await page.getByText("HAY, Habitat").isVisible(),
    "stated brands carried into the profile",
  );
  await page.screenshot({
    path: `${OUT}taste-02-interpreted.png`,
    fullPage: true,
  });

  // Adjust: edit one attribute, remove another, save.
  await page.getByRole("button", { name: "Adjust taste" }).click();
  const attr1 = page.getByLabel("Attribute 1", { exact: true });
  const attr2 = page.getByLabel("Attribute 2", { exact: true });
  const original1 = await attr1.inputValue();
  const removed = await attr2.inputValue();
  await attr1.fill("Warm oak, softly lit (e2e)");
  await page
    .getByRole("list", { name: "Taste attributes" })
    .getByRole("button", { name: `Remove ${removed}` })
    .click();
  const pendingText = await page.getByText(/unsaved change/).textContent();
  log(
    `edit "${original1}" → "Warm oak, softly lit (e2e)"; remove "${removed}"`,
  );
  check(
    /1 changed, 1 removed/.test(pendingText ?? ""),
    `unsaved changes summarised → "${pendingText}"`,
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Saved. Your corrections are kept").waitFor();
  check(
    await page.getByText("Corrected by you").isVisible(),
    "saved → status Corrected by you",
  );
  await page.getByRole("button", { name: "Looks like me" }).click();
  await page.getByText("You confirmed this looks like you.").waitFor();
  check(true, "Looks like me → confirmed");

  // Reload: edits persisted.
  await page.reload();
  await page
    .getByRole("heading", { name: "What you're drawn to" })
    .waitFor({ timeout: 20000 });
  const after = (await likes().allTextContents()).concat(
    await avoids().allTextContents(),
  );
  check(
    after.some((t) => t.includes("Warm oak, softly lit (e2e)")) &&
      after.some((t) => t.includes("Your words")),
    "after reload → edited attribute shown as your words",
  );
  check(
    !after.some((t) => t.startsWith(removed)),
    `after reload → "${removed}" stays removed`,
  );
  check(
    await page.getByText("Confirmed by you").isVisible(),
    "after reload → Confirmed by you",
  );
  check(
    await ok(
      page.waitForFunction(
        () => {
          const imgs = [...document.querySelectorAll("li img")];
          return imgs.length >= 2 && imgs.every((i) => i.naturalWidth > 0);
        },
        null,
        { timeout: 20000 },
      ),
    ),
    "after reload → saved photos and thumbnails shown again",
  );
  await page.screenshot({
    path: `${OUT}taste-03-after-reload.png`,
    fullPage: true,
  });

  token = await session.token();
  const taste = await api(token, "/taste");
  const p = taste.body?.profile;
  const edited = p?.attributes?.find(
    (a) => a.value === "Warm oak, softly lit (e2e)",
  );
  check(
    taste.status === 200 &&
      p?.status === "accepted" &&
      edited?.userEdited === true &&
      !p.attributes.some((a) => a.value === removed) &&
      p.preferredBrands.includes("HAY") &&
      p.preferredColours.includes("Sage green"),
    `GET /taste → status ${p?.status}, edited attr userEdited=${edited?.userEdited}, brands ${p?.preferredBrands?.join("/")}`,
  );

  // Remove a photo (deletes the stored image too).
  await page
    .getByRole("listitem", { name: "Photo 1" })
    .getByRole("button", { name: "Remove Photo 1" })
    .click();
  await page.getByText("Photo removed and deleted.").waitFor();
  const left = await api(await session.token(), "/taste/inspiration");
  check(
    left.body?.items?.length === 2 &&
      !left.body.items.some((i) => i.reaction === "dislike"),
    "removed photo is gone from the server",
  );
} catch (e) {
  fail(e.message.split("\n")[0]);
  await page
    .screenshot({ path: `${OUT}taste-error.png`, fullPage: true })
    .catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
