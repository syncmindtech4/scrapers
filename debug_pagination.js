/**
 * debug_pagination2.js
 * Tests two ways of reaching page 2:
 *   A. Direct goto to ?page=2 (cold load), with a proper wait/timeout and
 *      a dump of what's on the page if cards never appear.
 *   B. Starting on page 1, then clicking the "2" pagination link (in-app nav).
 */

const { launchBrowser, blockHeavyResources } = require("./_utils");

const BASE = "https://www.fuzu.com/uganda/job";
const CARD_SELECTOR = "div.b2c-card";

async function tryDirectGoto(context) {
  console.log("\n=== A: direct goto ?page=2 ===");
  const page = await context.newPage();
  await blockHeavyResources(page);
  await page.goto(`${BASE}?page=2`, {
    waitUntil: "networkidle",
    timeout: 45000,
  });

  try {
    await page.waitForSelector(CARD_SELECTOR, { timeout: 10000 });
    const count = await page.locator(CARD_SELECTOR).count();
    const firstTitle = await page
      .locator(`${CARD_SELECTOR} h2 a`)
      .first()
      .textContent();
    console.log(`Cards found: ${count}, first title: ${firstTitle?.trim()}`);
  } catch (e) {
    console.log("No cards appeared within 10s. Dumping diagnostics...");
    console.log("Final URL:", page.url());
    const bodyText = await page.evaluate(() =>
      document.body.innerText.slice(0, 500),
    );
    console.log("Body text start:", bodyText);
    const cookieBannerVisible = await page.evaluate(
      () => !!document.querySelector("#CybotCookiebotDialog"),
    );
    console.log("Cookie banner present:", cookieBannerVisible);
  }
  await page.close();
}

async function tryClickNav(context) {
  console.log("\n=== B: click page-2 link from page 1 ===");
  const page = await context.newPage();
  await blockHeavyResources(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 });
  await page.waitForTimeout(1000);

  const firstTitleBefore = await page
    .locator(`${CARD_SELECTOR} h2 a`)
    .first()
    .textContent();
  console.log("Page 1 first title:", firstTitleBefore?.trim());

  const pageTwoLink = page.locator('a[href*="page=2"]').first();
  const exists = await pageTwoLink.count();
  console.log("Page-2 link found on page:", exists > 0);
  if (exists === 0) {
    await page.close();
    return;
  }

  await pageTwoLink.click();
  await page.waitForTimeout(2000);

  try {
    await page.waitForFunction(
      (sel, prevTitle) => {
        const el = document.querySelector(`${sel} h2 a`);
        return el && el.textContent.trim() !== prevTitle.trim();
      },
      CARD_SELECTOR,
      firstTitleBefore,
      { timeout: 10000 },
    );
    const count = await page.locator(CARD_SELECTOR).count();
    const firstTitleAfter = await page
      .locator(`${CARD_SELECTOR} h2 a`)
      .first()
      .textContent();
    console.log(
      `After click — cards: ${count}, first title: ${firstTitleAfter?.trim()}`,
    );
    console.log("URL after click:", page.url());
  } catch (e) {
    console.log("Card content did not change after clicking page-2 link.");
    console.log("URL after click:", page.url());
  }
  await page.close();
}

(async () => {
  const { browser, context } = await launchBrowser();
  try {
    await tryDirectGoto(context);
    await tryClickNav(context);
  } finally {
    await browser.close();
  }
})();
