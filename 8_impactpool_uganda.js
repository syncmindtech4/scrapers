/**
 * 8_impactpool_uganda.js (v2 — Added detail page scraping for sector/description)
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.impactpool.org/search?q=Uganda";
const CARD_SELECTOR = ".job-card, .search-result, .vacancy-item, article";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 800;
const INITIAL_DELAY_MS = 2500;
const MAX_DESC = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeList(page) {
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(INITIAL_DELAY_MS); // Human-like pause for Cloudflare
  await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 }).catch(() => {});

  return page.evaluate(
    ({ CARD_SELECTOR }) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        try {
          const a = card.querySelector(
            "a[href*='/job'], a[href*='/vacancy'], a[href*='/opportunity']",
          );
          if (!a) continue;
          const href = a.href;
          if (seen.has(href)) continue;
          seen.add(href);

          const titleEl = card.querySelector("h2, h3, .job-title, .title") || a;
          const title = clean(titleEl.textContent);
          if (!title) continue;

          const locationEl = card.querySelector(
            ".location, .duty-station, .place",
          );
          const location = locationEl ? clean(locationEl.textContent) : "";

          out.push({ title, location, href });
        } catch (e) {
          /* skip broken card */
        }
      }
      return out;
    },
    { CARD_SELECTOR },
  );
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 10000 }).catch(() => {});

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        // Sector / Organization
        const sectorEl = document.querySelector(
          ".organization, .sector, .category, .theme",
        );
        const sector = sectorEl ? clean(sectorEl.textContent) : "Not Specified";

        // Contract Type
        const typeEl = document.querySelector(
          ".contract-type, .job-type, .type",
        );
        const type = typeEl ? clean(typeEl.textContent) : "Not Specified";

        // Description
        const descEl = document.querySelector(
          ".description, .job-details, main, article",
        );
        let description = descEl ? clean(descEl.textContent) : "";

        // Date
        const timeEl = document.querySelector("time, .date");
        const posted = timeEl
          ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
          : "";

        return {
          sector,
          type,
          description: description.slice(0, MAX_DESC) || "Not Specified",
          posted,
        };
      },
      { MAX_DESC },
    );
  } catch (e) {
    return {
      sector: "Not Specified",
      type: "Not Specified",
      description: "Not Specified",
      posted: "",
    };
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  let results = [];

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);
    const cards = await scrapeList(listPage);
    await listPage.close();

    const details = new Array(cards.length).fill(null);
    let next = 0;

    async function worker() {
      while (next < cards.length) {
        const i = next++;
        details[i] = await scrapeDetail(context, cards[i].href);
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
      }
    }

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    results = cards.map((j, i) => {
      const d = details[i] || {
        sector: "Not Specified",
        type: "Not Specified",
        description: "Not Specified",
        posted: "",
      };
      return buildJobObject({
        title: j.title,
        location: j.location || "Uganda",
        industry_sector: d.sector,
        type: d.type,
        amount: "Not Disclosed",
        time_added: d.posted
          ? new Date(d.posted).toISOString()
          : new Date().toISOString(),
        description: d.description,
        url_link: j.href,
      });
    });
  } catch (err) {
    console.error("[impactpool_uganda] scrape failed:", err.message);
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
