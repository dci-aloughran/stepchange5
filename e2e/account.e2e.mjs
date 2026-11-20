// Account & privacy: header account link, AI-training consent, data export,
// account deletion (data + Clerk identity) and local data clean-up.
// Run against a local server so the server-side deletion is exercised:
//   E2E_APP=http://localhost:3004 E2E_SERVER=http://localhost:8794 \
//     node --env-file=../app/.env.local account.e2e.mjs
import { mkdirSync, readFileSync } from "node:fs";
import {
  api,
  clerkUserId,
  clerkUserStatus,
  fitsWidth,
  localJourneyKeys,
} from "./lib/account.mjs";
import { APP, reporter, SERVER, startSession } from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
log("app", APP, "server", SERVER);
const session = await startSession();
const { page } = session;

try {
  // ---- Signed out -----------------------------------------------------------
  await page.goto(`${APP}/account`);
  await page
    .getByRole("heading", { name: "Sign in to see your account" })
    .waitFor();
  check(true, "/account signed out → asks to sign in");
  check(
    await page.getByRole("link", { name: "Sign in" }).first().isVisible(),
    "header shows a Sign in link when signed out",
  );

  // Clerk sign-in page uses the app theme.
  await page.goto(`${APP}/sign-in`);
  await page.locator(".cl-card").first().waitFor();
  const cardBg = await page
    .locator(".cl-card")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  check(
    cardBg === "rgb(28, 39, 34)",
    `sign-in card uses app card colour (${cardBg})`,
  );
  await page.screenshot({ path: `${OUT}account-00-sign-in.png` });

  // Some local journey progress that must be cleared on deletion.
  await page.evaluate(() => {
    localStorage.setItem(
      "deloitful.journey",
      JSON.stringify({ journey: "buying" }),
    );
    localStorage.setItem("deloitful.rooms", JSON.stringify([]));
  });

  // ---- Sign in, open /account from the header --------------------------------
  await session.signIn();
  await page.goto(`${APP}/plan`);
  const accountLink = page.getByRole("link", { name: "Your account" });
  await accountLink.waitFor();
  await accountLink.click();
  await page.waitForURL("**/account");
  await page.getByText(session.email).waitFor();
  check(true, "header account link → /account showing the email");
  const userId = await clerkUserId(page);
  check(Boolean(userId), `Clerk user id ${userId}`);

  // A home so the export and deletion have something real to cover.
  const home = await api(session, "/homes", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Account Flat", journeyType: "buyer" }),
  });
  check(home.status === 201, `POST /homes → ${home.status}`);

  check(
    (await page
      .getByRole("link", { name: "Resume my plan" })
      .getAttribute("href")) === "/journey/review",
    "Resume my plan → /journey/review",
  );

  // ---- AI-training consent (default off) -------------------------------------
  const consent = page.getByRole("switch", { name: "Help improve our AI" });
  await page.waitForFunction(
    () => !document.querySelector("[role=switch]")?.hasAttribute("disabled"),
  );
  check(
    (await consent.getAttribute("aria-checked")) === "false",
    "consent defaults to off",
  );
  let me = await api(session, "/profile/me");
  check(me.body?.aiTrainingConsent === false, "server consent false");
  await consent.click();
  await page.getByText("Saved. Your data may be used").waitFor();
  check(
    (await consent.getAttribute("aria-checked")) === "true",
    "consent toggled on in UI",
  );
  me = await api(session, "/profile/me");
  check(
    me.body?.aiTrainingConsent === true,
    "GET /profile/me → aiTrainingConsent true",
  );
  await consent.click();
  await page.getByText("Saved. Your data won't be used").waitFor();
  me = await api(session, "/profile/me");
  check(
    me.body?.aiTrainingConsent === false,
    "consent revoked → aiTrainingConsent false",
  );
  await consent.click();
  await page.getByText("Saved. Your data may be used").waitFor();

  // ---- Download my data ---------------------------------------------------------
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download my data" }).click(),
  ]);
  const file = await download.path();
  const name = download.suggestedFilename();
  let data = null;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`export is not JSON: ${e.message}`);
  }
  check(
    /^deloitful-home-export-\d{4}-\d{2}-\d{2}\.json$/.test(name),
    `download filename ${name}`,
  );
  check(
    data?.format === "deloitful-home-export" &&
      data?.user?.id === userId &&
      data?.user?.aiTrainingConsent === true,
    "export JSON has format, user id and consent",
  );
  check(
    data?.homes?.some((h) => h.name === "E2E Account Flat"),
    "export JSON includes the home",
  );
  await page.getByText("Your data has been downloaded").waitFor();

  // ---- Layout ------------------------------------------------------------------
  await page.screenshot({ path: `${OUT}account-01-390.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  check(await fitsWidth(page), "/account reflows at 320px");
  await page.screenshot({ path: `${OUT}account-02-320.png` });
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- Delete my account -------------------------------------------------------
  await page
    .getByRole("button", { name: "Delete my account and data" })
    .click();
  const input = page.getByLabel("Type DELETE to confirm");
  const confirm = page.getByRole("button", {
    name: "Permanently delete everything",
  });
  check(
    await input.evaluate((el) => el === document.activeElement),
    "focus moves to confirmation",
  );
  check(await confirm.isDisabled(), "delete disabled until DELETE typed");
  await input.fill("DEL");
  check(await confirm.isDisabled(), "still disabled for partial word");
  await input.fill("DELETE");
  check(await confirm.isEnabled(), "enabled after typing DELETE");
  await page.screenshot({ path: `${OUT}account-03-confirm.png` });
  await confirm.click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  check(true, "redirected to / after deletion");
  await page.waitForTimeout(1000);
  check(
    (await localJourneyKeys(page)).length === 0,
    "local journey data cleared",
  );
  check(
    (await page.evaluate(() => window.Clerk?.user ?? null)) === null,
    "signed out in the browser",
  );
  check(
    (await page.getByRole("link", { name: "Sign in" }).count()) > 0,
    "header shows Sign in again",
  );
  const status = await clerkUserStatus(userId);
  check(status === 404, `Clerk user deleted (GET /v1/users/{id} → ${status})`);
} catch (e) {
  fail(e.stack ?? String(e));
  await page
    .screenshot({ path: `${OUT}account-error.png`, fullPage: true })
    .catch(() => {});
} finally {
  await session.close(log);
}

log(r.failures === 0 ? "ALL PASSED" : `${r.failures} FAILURE(S)`);
process.exit(r.failures === 0 ? 0 : 1);
