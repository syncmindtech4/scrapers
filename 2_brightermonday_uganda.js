/**
 * 2_brightermonday_uganda.js  (v2 — Paginated + Employer Fix)
 * BrighterMonday Uganda jobs — https://www.brightermonday.co.ug/jobs
 *
 * v2 changes:
 * - Added URL-based pagination (loops through ?page=1, ?page=2, etc.).
 * - Deduplicates jobs across pages using a Set.
 * - Stops early if a page returns 0 new jobs (end of results).
 * - Fixed missing `employer` field (now correctly maps the extracted company name).
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.brightermonday.co.ug/jobs";
const MAX_PAGES = 10; // Adjust this to scrape more/fewer pages
const PAGE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relativeToIso(text) {
  if (!text) return "";
  const now = new Date();
  const t = text.trim().toLowerCase();
  if (t === "today") return now.toISOString();
  if (t === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }
  const match = t.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const d = new Date(now);
    if (unit === "hour") d.setHours(d.getHours() - n);
    else if (unit === "day") d.setDate(d.getDate() - n);
    else if (unit === "week") d.setDate(d.getDate() - n * 7);
    else if (unit === "month") d.setMonth(d.getMonth() - n);
    return d.toISOString();
  }
  // Try direct Date parse as fallback
  const d = new Date(text);
  return isNaN(d.getTime()) ? text.trim() : d.toISOString();
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  const allRawJobs = [];
  const seenUrls = new Set();

  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      // Construct URL: Page 1 is the base URL, Page 2+ uses ?page=N
      const targetUrl = p === 1 ? LIST_URL : `${LIST_URL}?page=${p}`;
      console.error(`[brightermonday] scraping page ${p}: ${targetUrl}`);

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Wait for the job cards to appear
      await page
        .waitForSelector('div[data-cy="listing-cards-components"]', {
          timeout: 15000,
        })
        .catch(() => {});

      const rawJobs = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('div[data-cy="listing-cards-components"]'),
        );

        return cards.map((card) => {
          const linkEl = card.querySelector('a[data-cy="listing-title-link"]');
          const url = linkEl ? linkEl.href : "";
          const title = linkEl
            ? linkEl.getAttribute("title") || linkEl.textContent.trim()
            : "";

          const companyP = Array.from(card.querySelectorAll("p")).find(
            (p) =>
              p.className.includes("text-blue-700") &&
              !p.closest('a[data-cy="listing-title-link"]'),
          );
          const company = companyP ? companyP.textContent.trim() : "";

          const tagRow = Array.from(card.querySelectorAll("div")).find(
            (d) =>
              d.className.includes("flex-wrap") &&
              d.className.includes("mt-3") &&
              d.querySelector("span"),
          );
          const spans = tagRow
            ? Array.from(tagRow.querySelectorAll(":scope > span"))
            : [];

          const location = spans[0] ? spans[0].textContent.trim() : "";
          const type = spans[1] ? spans[1].textContent.trim() : "";
          const amountRaw = spans[2]
            ? spans[2].textContent.replace(/\s+/g, " ").trim()
            : "";

          let industry_sector = "";
          if (
            tagRow &&
            tagRow.nextElementSibling &&
            tagRow.nextElementSibling.tagName === "P"
          ) {
            industry_sector = tagRow.nextElementSibling.textContent.trim();
          }

          let posted = "";
          const mlAuto = Array.from(card.querySelectorAll("div")).find((d) =>
            d.className.includes("ml-auto"),
          );
          if (mlAuto) {
            const p = mlAuto.querySelector("p");
            if (p) posted = p.textContent.trim();
          }

          const descCandidates = Array.from(card.querySelectorAll("p")).filter(
            (p) =>
              p.className.includes("text-gray-700") &&
              p.textContent.trim().length > 40,
          );
          const description = descCandidates.length
            ? descCandidates[descCandidates.length - 1].textContent.trim()
            : "";

          return {
            title,
            company,
            location,
            type,
            amountRaw,
            industry_sector,
            posted,
            description,
            url,
          };
        });
      });

      // Deduplicate and accumulate
      let newCount = 0;
      for (const j of rawJobs) {
        if (j.url && j.title && !seenUrls.has(j.url)) {
          seenUrls.add(j.url);
          allRawJobs.push(j);
          newCount++;
        }
      }

      console.error(
        `[brightermonday] page ${p}: found ${rawJobs.length} cards, ${newCount} new. Total so far: ${allRawJobs.length}`,
      );

      // If no new jobs were found, we've reached the end of the listings
      if (newCount === 0) {
        console.error(
          "[brightermonday] no new jobs found on this page, stopping pagination.",
        );
        break;
      }

      // Polite delay before the next page
      await sleep(PAGE_DELAY_MS);
    }

    // Map to final schema
    return allRawJobs.map((j) =>
      buildJobObject({
        title: j.title,
        employer: j.company || "Not Specified", // FIX: Now correctly passing the company name!
        location: j.location || "Not Specified",
        industry_sector: j.industry_sector || "Not Specified",
        type: j.type || "Not Specified",
        amount:
          /confidential|negotiable/i.test(j.amountRaw) || !j.amountRaw
            ? "Not Disclosed"
            : j.amountRaw,
        time_added: relativeToIso(j.posted),
        description: j.description || "",
        url_link: j.url,
      }),
    );
  } catch (err) {
    console.error("[brightermonday_uganda] scrape failed:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    // Print first 2 as a preview, then the total count
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
    console.log(`\n✅ Total jobs scraped: ${data.length}`);
  });
}
