/**
 * 1_fuzu_uganda.js  (v8 — Fixed networkidle timeout & error handling)
 * Fuzu Uganda jobs — https://www.fuzu.com/uganda/job
 *
 * v8 changes:
 * - Replaced "networkidle" with "domcontentloaded" to prevent timeouts
 *   caused by Fuzu's background websockets/analytics.
 * - Wrapped page.goto in try/catch so a timeout on page 2 doesn't crash
 *   the script and lose the jobs already scraped from page 1.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");

const BASE_URL = "https://www.fuzu.com/uganda/job";
const CARD_SELECTOR = "div.b2c-card";
const MAX_DESC = 400;
const MIN_PAGE_DELAY_MS = 3000;
const MAX_PAGE_DELAY_MS = 6000;
const MAX_PAGES_HARD_CAP = 50;
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 600;

function toIso(text) {
  if (!text) return "";
  const t = String(text)
    .replace(/^posted:?\s*/i, "")
    .trim();
  const d = new Date(t + (/\d{4}-\d{2}-\d{2}T/.test(t) ? "" : " UTC"));
  return isNaN(d.getTime()) ? t : d.toISOString();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomDelay() {
  return (
    MIN_PAGE_DELAY_MS + Math.random() * (MAX_PAGE_DELAY_MS - MIN_PAGE_DELAY_MS)
  );
}

async function detectMaxPage(page) {
  const max = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="page="]')];
    let best = 1;
    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/page=(\d+)/);
      const text = (a.textContent || "").trim();
      best = Math.max(
        best,
        m ? parseInt(m[1], 10) : 0,
        /^\d+$/.test(text) ? parseInt(text, 10) : 0,
      );
    }
    return best;
  });
  return Number.isFinite(max) && max > 0 ? max : 1;
}

async function extractListCards(page) {
  await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 }).catch(() => {});
  return page.evaluate(
    ({ CARD_SELECTOR, MAX_DESC }) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const stripBullet = (s) => clean(s).replace(/^[•·-–—\s]+/, "");
      const stripHtml = (html) => {
        const d = document.createElement("div");
        d.innerHTML = html || "";
        return clean(d.textContent);
      };

      const pickLink = (card) =>
        card.querySelector("h2 a[href]") ||
        card.querySelector("h3 a[href]") ||
        card.querySelector('a[href*="/uganda/jobs/"]') ||
        Array.from(card.querySelectorAll("a[href]")).find(
          (x) => clean(x.textContent).length > 3,
        ) ||
        null;

      const cards = document.querySelectorAll(CARD_SELECTOR);
      const out = [];
      const seen = new Set();
      let firstCardHtml = null;

      for (const card of cards) {
        try {
          const a = pickLink(card);
          if (!a) {
            if (!firstCardHtml) firstCardHtml = card.outerHTML.slice(0, 2500);
            continue;
          }
          const href = a.href;
          if (seen.has(href)) continue;
          seen.add(href);

          const title = clean(a.textContent);
          const lines = (card.innerText || "")
            .split("\n")
            .map(stripBullet)
            .filter((l) => l && l !== title);
          const find = (re, maxLen = 90) =>
            lines.find((l) => re.test(l) && l.length <= maxLen) || "";

          const locRe =
            /district|kampala|remote|wakiso|entebbe|gulu|mbarara|jinja|mukono|lira|arua|mbale|fort portal|buliisa|kyenjojo|ntungamo|ntungamu|outside uganda/i;
          const location = find(locRe) || find(/uganda/i) || "Uganda";
          const type = find(
            /full[- ]?time|part[- ]?time|contract|internship|consultan|volunteer|temporary|permanent|fixed[- ]term/i,
            60,
          );
          const amount = find(/ugx|ushs|usd|\$|salary/i, 60);
          const timeEl = card.querySelector("time");
          const posted = timeEl
            ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
            : find(/\bago\b|posted|today|yesterday/i, 40);
          const desc = stripHtml(card.getAttribute("description")).slice(
            0,
            MAX_DESC,
          );

          out.push({ title, href, location, type, amount, posted, desc });
        } catch (e) {
          /* skip */
        }
      }
      return { jobs: out, firstCardHtml, cardCount: cards.length };
    },
    { CARD_SELECTOR, MAX_DESC },
  );
}

async function scrapeFuzuDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page
      .waitForSelector("h1, h2, [class*='title']", { timeout: 10000 })
      .catch(() => {});

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const text = document.body.innerText;

        // 1. Location (Look for "Location" label, ignore paywall)
        let location = "";
        const locMatch = text.match(/Location\s*[:\-]?\s*([^\n]+)/i);
        if (locMatch && !locMatch[1].includes("Join Fuzu")) {
          location = locMatch[1].split("•")[0].trim(); // "Kampala • Uganda" -> "Kampala"
        }

        // 2. Type (Look for "Contract Type", ignore paywall)
        let type = "";
        const typeMatch = text.match(/Contract Type\s*[:\-]?\s*([^\n]+)/i);
        if (typeMatch && !typeMatch[1].includes("Join Fuzu"))
          type = typeMatch[1].trim();

        // 3. Amount (Look for "Salary", ignore paywall)
        let amount = "";
        const amtMatch = text.match(/Salary\s*[:\-]?\s*([^\n]+)/i);
        if (amtMatch && !amtMatch[1].includes("Join Fuzu"))
          amount = amtMatch[1].trim();

        // 4. Sector (Look for "Industry" or breadcrumb format "Uganda/Kampala/Sector")
        let sector = "";
        const sectorMatch = text.match(/Industry\s*[:\-]?\s*([^\n]+)/i);
        if (sectorMatch && !sectorMatch[1].includes("Join Fuzu")) {
          sector = sectorMatch[1].trim();
        } else {
          // Breadcrumb fallback: "Uganda/Kampala/Sales, marketing, promotion"
          const bcMatch = text.match(
            /Uganda\s*\/\s*[^\/\n]+\s*\/\s*([A-Za-z\s,]+?)(?:\n|Optica|International|Retail|Education|Manufacturing|Health|Finance|IT|Agriculture|Construction|Transport|Energy|Telecom|Government|NGO|Hospitality|Real Estate|Legal|Admin|Sales|Marketing)/m,
          );
          if (bcMatch) sector = bcMatch[1].trim();
        }

        // 5. Employer (Look for Company name before industry tags like "Retail + 2 more")
        let employer = "";
        const empMatch = text.match(
          /([A-Z][a-zA-Z\s\.\-\&]+(?:Limited|University|Company|Group|Ltd|Inc|Bank|Foundation|Institute|Hospital|School|Ministry|NGO|International|Global|Uganda|Africa|Partners|Consulting|Services|Solutions|Technologies|Media|Council|Commission|Authority|Agency|Trust|Fund))\s*(?:Retail|Education|Manufacturing|Health|Finance|IT|Agriculture|Construction|Transport|Energy|Telecom|Government|NGO|Hospitality|Real Estate|Legal|Admin|Sales|Marketing)/,
        );
        if (empMatch) employer = empMatch[1].trim();

        // Fallback employer: look for "About the company" or similar
        if (!employer) {
          const aboutComp = text.match(
            /About the (?:company|employer|organization)\s*[:\-]?\s*([^\n]+)/i,
          );
          if (aboutComp) employer = aboutComp[1].trim();
        }

        // 6. Description (Text after "About the job" or "Description")
        let desc = "";
        const descMatch = text.match(
          /About the job(?:.*?Description)?(.*?)(?:Qualifications|Requirements|Responsibilities|How to Apply|Sign in and Apply|Job details|Company)/is,
        );
        if (descMatch && descMatch[1].length > 50) {
          desc = descMatch[1].replace(/\s+/g, " ").trim();
        }
        if (!desc || desc.length < 50) {
          const meta = document.querySelector(
            'meta[property="og:description"], meta[name="description"]',
          );
          if (meta) desc = clean(meta.getAttribute("content"));
        }
        // Strip paywall text from description
        desc = desc
          .replace(/Join Fuzu to view all job details.*/gi, "")
          .replace(/Sign in and Apply.*/gi, "")
          .trim();

        return {
          employer: employer || "Not Specified",
          industry_sector: sector || "Not Specified",
          type: type || "Not Specified",
          amount: amount || "Not Disclosed",
          location: location || "",
          description: desc.slice(0, MAX_DESC) || "Not Specified",
        };
      },
      { MAX_DESC },
    );
  } catch (e) {
    return null; // Fallback to list data
  } finally {
    await page.close();
  }
}

// FIXED loadPage function
async function loadPage(page, url, label) {
  try {
    // FIX 1: Use domcontentloaded. Fuzu's websockets/analytics block networkidle.
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const status = response ? response.status() : null;

    await page.waitForSelector(CARD_SELECTOR, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { ok: true, status };
  } catch (e) {
    // FIX 2: Catch the timeout error here so it doesn't crash the main scrape() function
    console.error(
      `[fuzu_uganda] ${label} failed to load or find cards: ${e.message.split("\n")[0]}`,
    );
    return { ok: false, status: null };
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allRaw = [];
  const seenUrls = new Set();

  try {
    const page = await context.newPage();
    await blockHeavyResources(page);

    // PHASE 1: list pagination
    const first = await loadPage(page, BASE_URL, "page 1");
    if (!first.ok) return [];

    const maxPage = Math.min(await detectMaxPage(page), MAX_PAGES_HARD_CAP);
    console.error(`[fuzu_uganda] detected ${maxPage} list page(s)`);

    let { jobs, firstCardHtml, cardCount } = await extractListCards(page);
    console.error(
      `[fuzu_uganda] page 1: ${cardCount} cards in DOM, ${jobs.length} extracted`,
    );
    if (jobs.length === 0 && cardCount > 0 && firstCardHtml) {
      console.error(
        "[DEBUG_FUZU] cards exist but no link matched. First card HTML:\n",
        firstCardHtml,
      );
    }

    let prevFirstHref = jobs[0]?.href || null;
    for (const j of jobs)
      if (!seenUrls.has(j.href)) {
        seenUrls.add(j.href);
        allRaw.push(j);
      }

    for (let p = 2; p <= maxPage; p++) {
      await sleep(randomDelay());
      const result = await loadPage(page, `${BASE_URL}?page=${p}`, `page ${p}`);

      // If page 2+ fails, we just break the loop and keep the jobs we already have!
      if (!result.ok) {
        console.error(
          `[fuzu_uganda] page ${p} failed. Stopping pagination, but keeping ${allRaw.length} jobs from previous pages.`,
        );
        break;
      }

      const ex = await extractListCards(page);
      console.error(
        `[fuzu_uganda] page ${p}: ${ex.cardCount} cards in DOM, ${ex.jobs.length} extracted`,
      );
      if (ex.jobs.length === 0) break;
      if (ex.jobs[0].href === prevFirstHref) break;
      prevFirstHref = ex.jobs[0].href;
      for (const j of ex.jobs)
        if (!seenUrls.has(j.href)) {
          seenUrls.add(j.href);
          allRaw.push(j);
        }
    }

    await page.close();
    console.error(
      `[fuzu_uganda] total unique jobs to fetch details for: ${allRaw.length}`,
    );
    if (allRaw.length === 0) return [];

    // PHASE 2: concurrent detail enrichment
    const details = new Array(allRaw.length).fill(null);
    let nextIdx = 0;
    async function worker() {
      while (nextIdx < allRaw.length) {
        const i = nextIdx++;
        details[i] = await scrapeFuzuDetail(context, allRaw[i].href);
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // PHASE 3: merge
    return allRaw.map((r, i) => {
      const d = details[i] || {};
      return buildJobObject({
        title: r.title,
        location:
          d.location && d.location !== "Uganda"
            ? d.location
            : r.location || "Uganda",
        industry_sector:
          d.industry_sector && d.industry_sector !== "Not Specified"
            ? d.industry_sector
            : "Not Specified",
        type:
          d.type && d.type !== "Not Specified"
            ? d.type
            : r.type || "Not Specified",
        amount:
          d.amount && d.amount !== "Not Disclosed"
            ? d.amount
            : r.amount || "Not Disclosed",
        time_added: toIso(r.posted),
        description:
          d.description && d.description !== "Not Specified"
            ? d.description
            : r.desc || "Not Specified",
        url_link: r.href,
        employer: d.employer || "Not Specified",
      });
    });
  } catch (err) {
    console.error("[fuzu_uganda] scrape failed:", err.message);
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
