/**
 * 1_fuzu_uganda.js  (v2)
 * Fuzu Uganda jobs — https://www.fuzu.com/uganda/job
 *
 * Built from debug_dom.js output:
 *  - Card:        div.b2c-card   (other classes are hashed styled-components; don't use them)
 *  - Job id:      card @id
 *  - Description: card @description attribute (HTML string) -> stripped to text
 *  - Title/link:  h2 a  (href like /uganda/jobs/<slug>)
 *  - Location / type / salary / posted / sector: NOT yet confirmed. Best-effort text
 *    heuristics are used. Run with DEBUG_FUZU=1 to print the first card's text lines
 *    and HTML so exact selectors can be written.
 */

const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const TARGET_URL = "https://www.fuzu.com/uganda/job";
const CARD_SELECTOR = "div.b2c-card";
const MAX_DESC = 400;

async function scrape() {
  const { browser, context } = await launchBrowser();
  let results = [];

  try {
    const page = await context.newPage();
    await blockHeavyResources(page);
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 });
    await page.waitForTimeout(1500);

    const debug = process.env.DEBUG_FUZU === "1";

    const raw = await page.evaluate(
      ({ CARD_SELECTOR, MAX_DESC, debug }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const stripHtml = (html) => {
          const d = document.createElement("div");
          d.innerHTML = html || "";
          return clean(d.textContent);
        };
        const out = [];
        const seen = new Set();
        let debugDone = false;

        for (const card of document.querySelectorAll(CARD_SELECTOR)) {
          try {
            const a = card.querySelector("h2 a[href]");
            if (!a) continue;
            const href = a.href;
            if (seen.has(href)) continue;
            seen.add(href);

            const title = clean(a.textContent);
            const lines = (card.innerText || "")
              .split("\n")
              .map(clean)
              .filter((l) => l && l !== title);

            const find = (re, maxLen = 90) =>
              lines.find((l) => re.test(l) && l.length <= maxLen) || "";

            const location = find(
              /district|kampala|uganda|remote|wakiso|entebbe|gulu|mbarara|jinja|mukono|lira|arua|mbale|fort portal/i,
            );
            const type = find(
              /full[- ]?time|part[- ]?time|contract|internship|consultan|volunteer|temporary|permanent|fixed[- ]term/i,
              60,
            );
            const amount = find(/ugx|ushs|usd|\$|salary/i, 60);
            const timeEl = card.querySelector("time");
            const posted = timeEl
              ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
              : find(/\bago\b|posted|today|yesterday/i, 40);
            const catLink = card.querySelector('a[href*="/uganda/job/"]');
            const sector = catLink ? clean(catLink.textContent) : "";

            const desc = stripHtml(card.getAttribute("description")).slice(
              0,
              MAX_DESC,
            );

            if (debug && !debugDone) {
              debugDone = true;
              const clone = card.cloneNode(true);
              clone.removeAttribute("description");
              console.log(
                "[DEBUG_FUZU] text lines:",
                JSON.stringify(lines, null, 2),
              );
              console.log("[DEBUG_FUZU] html:", clone.outerHTML.slice(0, 2500));
            }

            out.push({
              id: card.id,
              title,
              href,
              location,
              type,
              amount,
              posted,
              sector,
              desc,
            });
          } catch (e) {
            /* skip broken card */
          }
        }
        return out;
      },
      { CARD_SELECTOR, MAX_DESC, debug },
    );

    results = raw.map((r) =>
      buildJobObject({
        title: r.title,
        location: r.location || "Uganda",
        industry_sector: r.sector,
        type: r.type,
        amount: r.amount || "Not Disclosed",
        time_added: r.posted,
        description: r.desc,
        url_link: r.href,
      }),
    );
  } catch (err) {
    console.error("[fuzu_uganda] scrape failed:", err.message);
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
