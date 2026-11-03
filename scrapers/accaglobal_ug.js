/**
 * scrapers/accaglobal_ug.js
 * Custom scraper for ACCA Global Jobs (Uganda)
 * Bypasses the generic engine to strictly target /job/{id}/ URLs
 * and properly parse the structured job detail pages.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");
const { matchSector } = require("./generic_engine"); // Reuse our smart sector matcher

const LIST_URL = "https://jobs.accaglobal.com/jobs/uganda/";
const MAX_PAGES = 5;
const DETAIL_CONCURRENCY = 3;
const MAX_DESC = 1500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allJobs = [];
  const seenUrls = new Set();

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);

    for (let p = 1; p <= MAX_PAGES; p++) {
      const targetUrl = p === 1 ? LIST_URL : `${LIST_URL}?page=${p}`;
      console.error(`[accaglobal] scraping page ${p}: ${targetUrl}`);

      await listPage
        .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
      await sleep(2000); // Let JS render

      // STRICT FILTER: Only grab links that match /job/12345/
      const jobs = await listPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/job/"]'));
        return links
          .filter((a) => /\/job\/\d+\//.test(a.href))
          .map((a) => ({
            url: a.href.split("?")[0], // Remove query params like ?LinkSource=...
            title: a.textContent.trim().replace(/\s+/g, " "),
          }))
          .filter((j) => j.title.length > 5 && !/view details/i.test(j.title));
      });

      let newCount = 0;
      for (const j of jobs) {
        if (!seenUrls.has(j.url)) {
          seenUrls.add(j.url);
          allJobs.push(j);
          newCount++;
        }
      }

      console.error(
        `[accaglobal] page ${p}: found ${jobs.length} jobs, ${newCount} new.`,
      );
      if (newCount === 0 && p > 1) break;

      // Check if there is a next page
      const hasNext = await listPage.evaluate(() => {
        const nextBtn = document.querySelector(
          'a.next, a[rel="next"], .pagination .next a, a[aria-label="Next"]',
        );
        return !!nextBtn;
      });
      if (!hasNext && p > 1) break;

      await sleep(1500);
    }

    await listPage.close();
    console.error(
      `[accaglobal] Total unique: ${allJobs.length}. Fetching details...`,
    );

    // Detail fetching
    const details = new Array(allJobs.length).fill(null);
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < allJobs.length) {
        const i = nextIdx++;
        const page = await context.newPage();
        try {
          await blockHeavyResources(page);
          await page.goto(allJobs[i].url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });

          // Dismiss cookie banner if it exists
          await page
            .evaluate(() => {
              const dismissBtn = document.querySelector(
                'button[aria-label="Dismiss"], .cookie-dismiss, #onetrust-accept-btn-handler, .ccc-accept-button',
              );
              if (dismissBtn) dismissBtn.click();
            })
            .catch(() => {});

          details[i] = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            // Extract Employer (ACCA format: "Employer\nEY" or "Company\nDeloitte")
            let employer = "Not Specified";
            const empMatch =
              bodyText.match(/Employer\s*\n?\s*([^\n]+)/i) ||
              bodyText.match(/Company\s*\n?\s*([^\n]+)/i);
            if (empMatch) employer = empMatch[1].trim();

            // Extract Location (ACCA format: "Location\nKampala, Kampala, Uganda")
            let location = "Uganda";
            const locMatch = bodyText.match(/Location\s*\n?\s*([^\n]+)/i);
            if (locMatch) location = locMatch[1].trim().split(",")[0];

            // Extract Dates (ACCA format: "Posted\n26 Oct 2026")
            let time_added = new Date().toISOString();
            const postedMatch = bodyText.match(
              /Posted\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i,
            );
            if (postedMatch) {
              const d = new Date(postedMatch[1]);
              if (!isNaN(d.getTime())) time_added = d.toISOString();
            }

            // Extract Description
            let description = "";
            const descStart = bodyText.search(
              /Job Details|Job Description|Company Description|About the Role|Who We Are/i,
            );
            if (descStart > -1) {
              description = bodyText.substring(descStart, descStart + 3000);
            } else {
              description = bodyText.substring(0, 2000);
            }

            // Clean out the "Apply", "Save job", "Send job" noise at the top/bottom
            description = description
              .replace(/Apply \(This will open in a new window.*?/gis, "")
              .replace(/Save jobClick to add.*?/gis, "")
              .replace(/You need to sign in.*?/gis, "")
              .replace(/Send jobJob Details/gis, "Job Details")
              .replace(/Send job/gis, "")
              .replace(/View more categoriesView fewer categories/gis, "");

            return {
              employer,
              location,
              time_added,
              description: description.trim(),
            };
          });
        } catch (e) {
          console.error(
            `[accaglobal] Failed detail for ${allJobs[i].url}:`,
            e.message,
          );
        } finally {
          await page.close();
          await sleep(500);
        }
      }
    }
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // Map to final schema
    return allJobs.map((j, i) => {
      const d = details[i] || {};
      const desc = d.description || "";
      return buildJobObject({
        title: j.title.replace(/^View details\s*/i, "").trim(),
        url_link: j.url,
        employer: d.employer || "Not Specified",
        description: desc.substring(0, MAX_DESC) || "Not Specified",
        location: d.location || "Uganda",
        industry_sector: matchSector(desc + " " + j.title),
        type: "Not Specified",
        amount: "Not Disclosed",
        time_added: d.time_added || new Date().toISOString(),
      });
    });
  } catch (err) {
    console.error(`[accaglobal] Fatal error:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
