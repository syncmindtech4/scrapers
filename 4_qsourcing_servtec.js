/**
 * 4_qsourcing_servtec.js (v3 — Paginated + Detail Enriched)
 * Q-Sourcing Servtec jobs — https://qsourcing.com/jobs-in-uganda/
 *
 * v3 changes:
 * - Added pagination loop to capture jobs from all available pages.
 * - Uses a Set to deduplicate jobs across pages.
 * - Retains the regex-based detail page enrichment to extract hidden
 *   Employers ("Our client X") and Sectors ("in the X sector").
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://qsourcing.com/jobs-in-uganda/";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 600;
const MAX_DESC = 600;
const MAX_PAGES = 15; // Safety cap to prevent infinite loops

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page
      .waitForSelector(".job_description, .entry-content, main, article", {
        timeout: 10000,
      })
      .catch(() => {});

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        const descEl = document.querySelector(
          ".job_description, .entry-content, main article, .job-details, .content",
        );
        let fullText = descEl
          ? clean(descEl.innerText)
          : clean(document.body.innerText);

        // 1. Extract Employer
        let employer = "Not Specified";

        // Pattern A: "Our client [Name], in the..."
        const clientMatch = fullText.match(
          /our client[,:\s]+([A-Z][A-Za-z0-9\s\.\-\&\(\)]+?)(?:,\s*in the|\s+is\s+looking|\s+in\s+the|\s+is\s+a)/i,
        );
        if (clientMatch) {
          let name = clientMatch[1].trim();
          if (!/^(in the|a leading|an|a|in|one of)/i.test(name)) {
            employer = name;
          }
        }

        // Pattern B: "Company: [Name]"
        if (employer === "Not Specified") {
          const compMatch = fullText.match(
            /Company[:\s]+([A-Z][A-Za-z0-9\s\.\-\&\(\)]+)/,
          );
          if (compMatch) employer = compMatch[1].trim();
        }

        // Pattern C: "Job purpose [Company Name] sells/operates/is..." (Catches Mapalo Pads!)
        if (employer === "Not Specified") {
          const jobPurposeMatch = fullText.match(
            /Job purpose\s+([A-Z][A-Za-z0-9\s\.\-\&\(\)]+?)(?:\s+sells|\s+operates|\s+is\s+a|\s+is\s+an|\s+is\s+the|\s+provides|\s+offers|\.)/i,
          );
          if (jobPurposeMatch) {
            let name = jobPurposeMatch[1].trim();
            // Filter out false positives like "The role", "We", "This"
            if (
              !/^(the|a|an|we|our|this|the role|the successful)/i.test(name)
            ) {
              employer = name;
            }
          }
        }

        // Pattern D: "Client Profile: [Name]" or "About the Company"
        if (employer === "Not Specified") {
          const profileMatch = fullText.match(
            /(?:Client Profile|About the Company|About our client|Company Profile)[:\s]+([A-Z][A-Za-z0-9\s\.\-\&\(\)]+?)(?:\.|\n)/i,
          );
          if (profileMatch) employer = profileMatch[1].trim();
        }

        // 2. Extract Industry Sector
        let sector = "Not Specified";
        const sectorMatch = fullText.match(
          /in the ([A-Za-z0-9\s\-\(\)]+?)(?:\s+sector|\s+industry)/i,
        );
        if (sectorMatch) {
          sector = sectorMatch[1].trim();
          sector = sector.charAt(0).toUpperCase() + sector.slice(1); // Capitalize
        }
        if (sector === "Not Specified") {
          const indMatch = fullText.match(
            /Industry[:\s]+([A-Za-z0-9\s\-\(\)]+)/i,
          );
          if (indMatch) sector = indMatch[1].trim();
        }

        // 3. Clean up description
        let description = fullText.slice(0, MAX_DESC);

        return {
          description: description || "Not Specified",
          employer: employer,
          industry_sector: sector,
        };
      },
      { MAX_DESC },
    );
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const listPage = await context.newPage();
  await blockHeavyResources(listPage);

  let allCards = [];
  const seenUrls = new Set();

  try {
    await listPage.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      console.error(`[qsourcing] scraping list page ${currentPage}...`);
      await listPage
        .waitForSelector("li.job_listing", { timeout: 15000 })
        .catch(() => {});

      const { jobs, nextPageUrl } = await listPage.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        const cards = Array.from(document.querySelectorAll("li.job_listing"));
        const jobs = cards
          .map((card) => {
            const a = card.querySelector("a");
            const url = a ? a.href : "";
            const h3 = card.querySelector("h3");
            const title = h3 ? h3.textContent.trim() : "";
            const companyEl = card.querySelector(".company");
            const company = companyEl ? companyEl.textContent.trim() : "";
            const locationEl = card.querySelector(".location");
            const location = locationEl ? locationEl.textContent.trim() : "";
            const typeEl = card.querySelector(".job-type");
            const type = typeEl ? typeEl.textContent.trim() : "";
            const timeEl = card.querySelector("time");
            const datetime = timeEl ? timeEl.getAttribute("datetime") : "";
            return { title, company, location, type, datetime, url };
          })
          .filter((j) => j.url && j.title);

        // Find the "Next" page link
        let nextPageUrl = "";
        const nextLink = document.querySelector(
          '.pagination .next a, a.next, .job_listings_pagination .next a, a[rel="next"], .nav-next a',
        );
        if (nextLink && nextLink.href) {
          nextPageUrl = nextLink.href;
        } else {
          // Fallback: look for a link with text "Next" or "»"
          const allLinks = Array.from(document.querySelectorAll("a"));
          const nextByText = allLinks.find((a) =>
            /next|»|›/i.test(a.textContent.trim()),
          );
          if (nextByText && nextByText.href) nextPageUrl = nextByText.href;
        }

        return { jobs, nextPageUrl };
      });

      let newCount = 0;
      for (const j of jobs) {
        if (!seenUrls.has(j.url)) {
          seenUrls.add(j.url);
          allCards.push(j);
          newCount++;
        }
      }

      console.error(
        `[qsourcing] page ${currentPage}: found ${jobs.length} jobs, ${newCount} new. Total: ${allCards.length}`,
      );

      // Stop if no new jobs or no next page link
      if (newCount === 0 || !nextPageUrl) {
        console.error(
          "[qsourcing] no more pages or no new jobs. Stopping pagination.",
        );
        break;
      }

      // Navigate to next page
      await listPage.goto(nextPageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await new Promise((r) => setTimeout(r, 1500)); // Polite delay
      currentPage++;
    }

    await listPage.close();
    console.error(
      `[qsourcing] total unique jobs found: ${allCards.length}. Fetching details...`,
    );

    // Concurrent detail scraping phase
    const details = new Array(allCards.length).fill(null);
    let next = 0;

    async function worker() {
      while (next < allCards.length) {
        const i = next++;
        details[i] = await scrapeDetail(context, allCards[i].url);
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
      }
    }

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // Map to final schema
    const results = allCards.map((j, i) => {
      const d = details[i] || {
        description: "Not Specified",
        employer: "Not Specified",
        industry_sector: "Not Specified",
      };
      const finalEmployer =
        d.employer !== "Not Specified"
          ? d.employer
          : j.company || "Not Specified";

      return buildJobObject({
        title: j.title,
        location: j.location || "Not Specified",
        industry_sector: d.industry_sector,
        type: j.type || "Not Specified",
        amount: "Not Disclosed",
        time_added: j.datetime
          ? `${j.datetime}T00:00:00.000Z`
          : new Date().toISOString(),
        description: d.description,
        url_link: j.url,
        employer: finalEmployer,
      });
    });

    return results;
  } catch (err) {
    console.error("[qsourcing] scrape failed:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
    console.log(`\n✅ Total jobs scraped: ${data.length}`);
  });
}
