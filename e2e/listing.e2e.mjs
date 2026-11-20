// Listing preview: screenshots / pasted text → AI-read details, no guessing.
import { mkdirSync } from "node:fs";
import { listingScreenshot } from "./lib/listing.mjs";
import { APP, reporter, startSession } from "./lib/session.mjs";

const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { log, check, fail } = r;
const session = await startSession();
const { page } = session;

try {
  await page.goto(`${APP}/listing-preview`);
  check(
    await page.getByRole("button", { name: "Sign in to add a listing" }).waitFor({ timeout: 15000 }).then(() => true, () => false),
    "signed out → asked to sign in",
  );
  await session.signIn();
  await page.goto(`${APP}/listing-preview`);

  // 1. Screenshot path
  await page.locator('input[type=file]').setInputFiles({ name: "listing.png", mimeType: "image/png", buffer: await listingScreenshot() });
  await page.getByRole("button", { name: "Read listing" }).click();
  log("reading screenshot…");
  await page.locator('[data-testid="listing-preview-card"], [role=alert]').first().waitFor({ timeout: 150000 });
  const alert = await page.locator("[role=alert]").textContent().catch(() => null);
  if (alert) throw new Error(`extraction error: ${alert}`);
  const card = page.getByTestId("listing-preview-card");
  const fact = async (label) => (await card.locator("div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd").textContent())?.trim();
  const facts = Object.fromEntries(await Promise.all(["Price", "Address", "Type", "Bedrooms", "Bathrooms", "Floor area", "Tenure"].map(async (l) => [l, await fact(l)])));
  log("facts:", JSON.stringify(facts));
  check(/£325,000/.test(facts.Price ?? ""), `price read from screenshot (${facts.Price})`);
  check(facts.Bedrooms === "3" && facts.Bathrooms === "2", "bedrooms 3, bathrooms 2");
  check(/semi/i.test(facts.Type ?? ""), `type ${facts.Type}`);
  check(facts["Floor area"] === "Not shown", "floor area not invented");
  check(facts.Address === "Not shown" || !/\d{1,3} [A-Z]/.test(facts.Address ?? ""), `address not invented (${facts.Address})`);
  const roomsText = await card.textContent();
  check(/Living Room.*4\.6 × 3\.8 m/i.test(roomsText), "room sizes from the description listed");
  check(/South-facing rear garden/.test(roomsText), "key features listed");
  await page.screenshot({ path: `${OUT}listing-preview.png`, fullPage: true });
  await page.getByRole("button", { name: "Use these details" }).click();
  const applied = JSON.parse((await page.getByTestId("applied").textContent()) ?? "{}");
  check(applied.pricePence === 32_500_000 && applied.bedrooms === 3, "Use these details hands the result to the journey");

  // 2. Pasted-text path
  await page.getByRole("button", { name: "Start again with different screenshots" }).click();
  await page.getByLabel("Or paste the listing text").fill("Offers over £410,000. A two bedroom ground floor flat with one bathroom. Approx 720 sq ft. Leasehold. Lounge 5.2m x 3.9m.");
  await page.getByRole("button", { name: "Read listing" }).click();
  await page.getByTestId("listing-preview-card").waitFor({ timeout: 150000 });
  const t = await page.getByTestId("listing-preview-card").textContent();
  check(/£410,000/.test(t) && /Flat/i.test(t) && /66\.9 m²/.test(t), "pasted text read (price, flat, 720 sq ft → 66.9 m²)");
} catch (e) {
  fail(e.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}listing-error.png`, fullPage: true }).catch(() => {});
} finally {
  await session.close(log);
  log(r.failures ? `${r.failures} FAILURE(S)` : "ALL CHECKS PASSED");
  process.exitCode = r.failures ? 1 : 0;
}
