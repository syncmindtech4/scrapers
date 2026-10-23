/**
 * 3_reliefweb_uganda.js  (v6 — Fixed 0-Indexed Pagination)
 * ReliefWeb jobs filtered to Uganda (advanced-search=(C240)).
 *
 * v6 changes:
 * - ReliefWeb uses 0-indexed pagination (?page=0 is page 1, ?page=1 is page 2).
 * - detectLastPage() now correctly finds the highest page INDEX.
 * - The loop now correctly starts at p=1 and goes up to the highest index.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");

const BASE_URL = "https://reliefweb.int/jobs?advanced-search=%28C240%29";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 700;
const MAX_DESC = 400;
const MAX_PAGES_HARD_CAP = 50;
const PAGE_DELAY_MS = 1500;

const CODE_FIELD = { CC: "sector", T: "sector", TY: "type", EX: "experience" };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads the pager and returns the highest page INDEX found (0-indexed).
 * e.g., if links are ?page=0, ?page=1, ?page=2, it returns 2.
 */
async function detectLastPageIndex(page) {
  return page.evaluate(() => {
    let best = 0;
    const links = document.querySelectorAll(
      '.cd-pager a[href*="page="], a[rel="next"], a[rel="last"]',
    );
    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/page=(\d+)/);
      if (m) best = Math.max(best, parseInt(m[1], 10));
    }
    return best;
  });
}

async function scrapeListPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page
    .waitForSelector('a[href*="/job/"]', { timeout: 20000 })
    .catch(() => {});

  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const codeOf = (a) => {
      const m = decodeURIComponent(a.getAttribute("href") || "").match(
        /advanced-search=(([A-Z]+)(\d+))/,
      );
      return m ? m[1] : "";
    };

    const out = [];
    const seen = new Set();

    for (const a of document.querySelectorAll("a[href]")) {
      try {
        if (!/\/job\/\d+/.test(a.getAttribute("href") || "")) continue;
        const href = a.href;
        const title = clean(a.textContent);
        if (!title || seen.has(href)) continue;

        const container =
          a.closest("article") || a.closest("li") || a.parentElement;
        if (!container) continue;

        seen.add(href);
        const tags = Array.from(
          container.querySelectorAll('a[href*="advanced-search"]'),
        ).map((x) => ({ code: codeOf(x), text: clean(x.textContent) }));

        const countries = tags.filter((t) => t.code === "C").map((t) => t.text);
        const orgs = tags.filter((t) => t.code === "S").map((t) => t.text);
        const timeEl = container.querySelector("time");

        out.push({
          title,
          href,
          countries,
          orgs,
          time_added: timeEl
            ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
            : "",
        });
      } catch (e) {
        /* skip */
      }
    }
    return out;
  });
}

async function scrapeDetail(context, url, debug) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForSelector("h1", { timeout: 15000 }).catch(() => {});

    return await page.evaluate(
      ({ CODE_FIELD, MAX_DESC, debug }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const res = { sector: [], type: [], experience: [], desc: "" };
        const groups = {};

        for (const a of document.querySelectorAll(
          'a[href*="advanced-search"]',
        )) {
          const m = decodeURIComponent(a.getAttribute("href") || "").match(
            /advanced-search=\(([A-Z]+)(\d+)\)/,
          );
          if (!m) continue;
          const text = clean(a.textContent);
          if (!text) continue;
          (groups[m[1]] = groups[m[1]] || []).push(text);
          const field = CODE_FIELD[m[1]];
          if (field) res[field].push(text);
        }

        const labelGrab = (re) => {
          for (const n of document.querySelectorAll(
            'dt, th, h3, h4, strong, label, [class*="label"]',
          )) {
            const t = clean(n.textContent);
            if (t.length < 40 && re.test(t)) {
              const sib = n.nextElementSibling;
              if (sib) return clean(sib.textContent);
            }
          }
          return "";
        };

        if (!res.type.length) {
          const v = labelGrab(/job type|contract|employment/i);
          if (v) res.type.push(v);
        }
        if (!res.sector.length) {
          const v = labelGrab(/career categor|theme|sector/i);
          if (v) res.sector.push(v);
        }

        const og = document.querySelector(
          'meta[property="og:description"], meta[name="description"]',
        );
        let desc = og ? clean(og.getAttribute("content")) : "";
        if (!desc) {
          const p = Array.from(document.querySelectorAll("main p, article p"))
            .map((x) => clean(x.textContent))
            .find((t) => t.length > 60);
          desc = p || "";
        }
        res.desc = desc.slice(0, MAX_DESC);
        if (debug) res.groups = groups;
        return res;
      },
      { CODE_FIELD, MAX_DESC, debug },
    );
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allCards = [];
  const seenHrefs = new Set();
  const page = await context.newPage();
  await blockHeavyResources(page);

  try {
    // 1. Load page 0 (the base URL)
    const firstCards = await scrapeListPage(page, BASE_URL);
    for (const c of firstCards) {
      if (!seenHrefs.has(c.href)) {
        seenHrefs.add(c.href);
        allCards.push(c);
      }
    }

    let lastPageIndex = await detectLastPageIndex(page);
    lastPageIndex = Math.min(lastPageIndex || 0, MAX_PAGES_HARD_CAP);
    console.error(
      `[reliefweb_uganda] detected highest page index: ${lastPageIndex} (0-indexed)`,
    );
    console.error(
      `[reliefweb_uganda] page index 0: ${firstCards.length} cards`,
    );

    // 2. Loop through remaining pages (index 1 to lastPageIndex)
    for (let p = 1; p <= lastPageIndex; p++) {
      await sleep(PAGE_DELAY_MS);
      const url = `${BASE_URL}&page=${p}`;
      console.error(`[reliefweb_uganda] scraping page index ${p}...`);

      const cards = await scrapeListPage(page, url);
      let newCount = 0;
      for (const c of cards) {
        if (!seenHrefs.has(c.href)) {
          seenHrefs.add(c.href);
          allCards.push(c);
          newCount++;
        }
      }

      console.error(
        `[reliefweb_uganda] page index ${p}: ${cards.length} cards, ${newCount} new. Total: ${allCards.length}`,
      );

      if (newCount === 0) {
        console.error("[reliefweb_uganda] no new jobs on this page, stopping.");
        break;
      }
    }

    await page.close();
    console.error(
      `[reliefweb_uganda] total unique jobs to fetch details for: ${allCards.length}`,
    );

    // 3. Concurrent detail-page scraping
    const details = new Array(allCards.length).fill(null);
    let next = 0;
    let debugPrinted = false;

    async function worker() {
      while (next < allCards.length) {
        const i = next++;
        const wantDebug = process.env.DEBUG_RW === "1" && !debugPrinted;
        if (wantDebug) debugPrinted = true;

        details[i] = await scrapeDetail(context, allCards[i].href, wantDebug);

        if (wantDebug && details[i] && details[i].groups) {
          console.log("[DEBUG_RW] tag-code groups on", allCards[i].href);
          console.log(JSON.stringify(details[i].groups, null, 2));
        }
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
      }
    }

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // 4. Map to schema
    return allCards.map((c, i) => {
      const d = details[i] || { sector: [], type: [], desc: "" };
      const org = c.orgs.length ? `Organization: ${c.orgs.join(", ")}. ` : "";

      return buildJobObject({
        title: c.title,
        location: c.countries.length ? c.countries.join(", ") : "Uganda",
        industry_sector: d.sector.join(", ") || "Not Specified",
        type: d.type.join(", ") || "Not Specified",
        amount: "Not Disclosed",
        time_added: c.time_added || new Date().toISOString(),
        description: (org + (d.desc || "")).trim() || "Not Specified",
        url_link: c.href,
      });
    });
  } catch (err) {
    console.error("[reliefweb_uganda] scrape failed:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
