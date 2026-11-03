/**
 * scrapers/unjobs_uganda.js
 * Custom scraper for UN Jobs (Uganda Duty Station)
 * Bypasses the generic engine to handle UN's unique HTML structure.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");
const { matchSector } = require("./generic_engine");

const LIST_URL = "https://unjobs.org/duty_stations/uganda";
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

    console.error(`[unjobs] scraping: ${LIST_URL}`);
    // UN Jobs relies heavily on JS to render the list, so we use networkidle
    await listPage
      .goto(LIST_URL, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await sleep(2500);

    // Grab all links that look like job titles (long text, deep URLs)
    const jobs = await listPage.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      return links
        .filter((a) => {
          const href = a.href || "";
          const text = a.textContent.trim();
          return (
            text.length > 25 &&
            text.length < 200 &&
            !href.includes("/duty_stations/") &&
            !href.includes("/organizations/") &&
            !href.includes("/tags/") &&
            !href.includes("twitter.com") &&
            !href.includes("facebook.com") &&
            href.split("/").length > 4
          ); // Ensures it's a specific job page, not a category
        })
        .map((a) => ({
          url: a.href,
          title: a.textContent.trim().replace(/\s+/g, " "),
        }));
    });

    for (const j of jobs) {
      if (!seenUrls.has(j.url)) {
        seenUrls.add(j.url);
        allJobs.push(j);
      }
    }

    console.error(
      `[unjobs] Found ${allJobs.length} unique jobs. Fetching details...`,
    );
    await listPage.close();

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

          details[i] = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            // UN Jobs specific parsing
            let employer = "UN Agency";
            const orgMatch =
              bodyText.match(/Organization[:\s]+([^\n]+)/i) ||
              bodyText.match(/Agency[:\s]+([^\n]+)/i);
            if (orgMatch) employer = orgMatch[1].trim();

            let location = "Uganda";
            const locMatch = bodyText.match(/Duty Station[:\s]+([^\n]+)/i);
            if (locMatch) location = locMatch[1].trim();

            let time_added = new Date().toISOString();
            const dateMatch =
              bodyText.match(/Deadline[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
              bodyText.match(/Posted[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i);
            if (dateMatch) {
              const d = new Date(dateMatch[1]);
              if (!isNaN(d.getTime())) time_added = d.toISOString();
            }

            let description = bodyText.substring(0, 2000);

            return {
              employer,
              location,
              time_added,
              description: description.trim(),
            };
          });
        } catch (e) {
          /* silent fail for individual pages */
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

      // UN Jobs are almost always NGO & Development, so we force that if the matcher misses
      let sector = matchSector(desc + " " + j.title);
      if (sector === "Not Specified") sector = "NGO & Development";

      return buildJobObject({
        title: j.title,
        url_link: j.url,
        employer: d.employer || "UN Agency",
        description: desc.substring(0, MAX_DESC) || "Not Specified",
        location: d.location || "Uganda",
        industry_sector: sector,
        type: "Not Specified",
        amount: "Not Disclosed",
        time_added: d.time_added || new Date().toISOString(),
      });
    });
  } catch (err) {
    console.error(`[unjobs] Fatal error:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
