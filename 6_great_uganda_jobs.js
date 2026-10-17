/**
 * 6_greatugandajobs.js (v3 — Targeted /jobs/ path + Detail Enriched)
 * Great Uganda Jobs — https://www.greatugandajobs.com/jobs/
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.greatugandajobs.com/jobs/";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 600;
const MAX_DESC = 600;
const MAX_PAGES = 20;

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        // 1. Get the raw body text
        let text = document.body.innerText;

        // 2. Aggressively strip out known Great Uganda Jobs Header/Nav/Footer noise blocks
        text = text.replace(
          /LOG IN POST A JOB ADD CV ALERTS.*?Jobs by Categories L/gis,
          " ",
        );
        text = text.replace(
          /Home Jobseeker Back Add your CV.*?Whatsapp Group \(Join\)/gis,
          " ",
        );
        text = text.replace(/Via FB Page.*?Telegram Group \(Join\)/gis, " ");
        text = text.replace(
          /Employer Back Employer Control Panel.*?Posting Price/gis,
          " ",
        );
        text = text.replace(
          /PHL does not and shall not discriminate.*?subcontractors and vendors\./gis,
          " ",
        );
        text = text.replace(
          /does not and shall not discriminate.*?welcoming environment[^.]*\./gis,
          " ",
        );

        // 3. Split into lines and filter out any line that looks like a menu or boilerplate
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 30);

        const validLines = lines.filter((line) => {
          const lower = line.toLowerCase();
          return (
            !lower.includes("whatsapp group") &&
            !lower.includes("join it") &&
            !lower.includes("follow it") &&
            !lower.includes("subscribe") &&
            !lower.includes("post a job") &&
            !lower.includes("upload job") &&
            !lower.includes("search cvs") &&
            !lower.includes("tenders in uganda") &&
            !lower.includes("weekly jobs") &&
            !lower.includes("related jobs") &&
            !lower.includes("jobs by categories") &&
            !lower.includes("24x7 live support") &&
            !lower.includes("admin@lafabsolution")
          );
        });

        // Join the surviving lines (this is your actual job description)
        let description = validLines.join(" ");

        // 4. Cut off at "How to Apply" or "Share this job"
        const applyIdx = description.search(
          /how to apply|application procedure|submit your application|send your cv|interested candidates|share this job|leave a reply|copyright|duty station/i,
        );
        if (applyIdx > 50) {
          description = description.substring(0, applyIdx).trim();
        }

        // 5. Final cleanup
        description = clean(description);

        return {
          description: description.slice(0, MAX_DESC) || "Not Specified",
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
      console.error(`[greatugandajobs] scraping list page ${currentPage}...`);

      // Wait for job links to appear
      await listPage
        .waitForSelector(
          'a[href*="/jobs/job-detail/"], a[href*="/job-detail/"]',
          { timeout: 15000 },
        )
        .catch(() => {});

      const { jobs, nextPageUrl } = await listPage.evaluate(() => {
        const jobs = [];
        const seen = new Set();

        // Great Uganda Jobs specific job links
        let targetLinks = Array.from(
          document.querySelectorAll(
            'a[href*="/jobs/job-detail/"], a[href*="/job-detail/"]',
          ),
        );

        // Fallback if the URL structure changed slightly
        if (targetLinks.length === 0) {
          targetLinks = Array.from(document.querySelectorAll("a")).filter(
            (a) => {
              const text = a.textContent.trim().toLowerCase();
              return (
                text.includes("job at") ||
                text.includes("tender at") ||
                text.includes("vacancy at")
              );
            },
          );
        }

        for (const link of targetLinks) {
          const url = link.href;
          if (!url || seen.has(url)) continue;
          // Filter out generic category links
          if (url.endsWith("/jobs/") || url.endsWith("/jobs")) continue;

          seen.add(url);

          const card =
            link.closest("div, li, tr, article, .job-item") ||
            link.parentElement;
          const rawTitle = link.textContent.trim();

          // Smart Title & Employer Splitting
          let title = rawTitle;
          let employer = "Not Specified";

          const empMatch = rawTitle.match(/job at (.+)$/i);
          if (empMatch) {
            employer = empMatch[1].trim();
            title = rawTitle.replace(/\s*job at .*$/i, "").trim();
          }
          const tenderMatch = rawTitle.match(/tender at (.+)$/i);
          if (tenderMatch) {
            employer = tenderMatch[1].trim();
            title = rawTitle.replace(/\s*tender at .*$/i, "").trim();
          }
          const vacancyMatch = rawTitle.match(/vacancy at (.+)$/i);
          if (vacancyMatch) {
            employer = vacancyMatch[1].trim();
            title = rawTitle.replace(/\s*vacancy at .*$/i, "").trim();
          }

          const text = card ? card.innerText || "" : "";

          // Location
          let location = "Uganda";
          const locEl = card
            ? card.querySelector(".location, .job-location")
            : null;
          if (locEl) location = locEl.textContent.trim();
          else {
            const locMatch = text.match(
              /([A-Za-z\s]+(?:\|\s*Uganda|,\s*Uganda|District|Kampala|Jinja|Mbarara|Gulu|Arua|Mbale|Wakiso|Entebbe))/i,
            );
            if (locMatch) location = locMatch[1].replace(/\|.*$/, "").trim();
          }

          // Sector
          let industry_sector = "Not Specified";
          const secEl = card
            ? card.querySelector(".sector, .industry, .category")
            : null;
          if (secEl) industry_sector = secEl.textContent.trim();
          else {
            const secMatch = text.match(
              /(Computer\/ IT|Accounting\/ Finance|Sales|Management|Administrative|Education\/ Academic|Health\/ Medicine|Logistics|Customer Service|Tenders in Uganda|Advertising|Hospitality|Technician|Engineering|Agriculture|Legal|Marketing)/i,
            );
            if (secMatch) {
              industry_sector = secMatch[1].trim();
              industry_sector =
                industry_sector.charAt(0).toUpperCase() +
                industry_sector.slice(1); // Capitalizes "sales" to "Sales"
            }
          }

          // Type
          let type = "Not Specified";
          const typeEl = card
            ? card.querySelector(".job-type, .employment-type")
            : null;
          if (typeEl) type = typeEl.textContent.trim();
          else {
            const typeMatch = text.match(
              /(Full-time|Part-time|Contract|Internship|Temporary|Freelance)/i,
            );
            if (typeMatch) type = typeMatch[1].trim();
          }

          // Date
          let time_added = "";
          const timeEl = card ? card.querySelector("time") : null;
          if (timeEl)
            time_added =
              timeEl.getAttribute("datetime") || timeEl.textContent.trim();
          else {
            const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}T[\d:\.]+Z)/);
            if (dateMatch) time_added = dateMatch[1];
          }

          jobs.push({
            title,
            employer,
            location,
            industry_sector,
            type,
            time_added,
            url,
          });
        }

        // FIXED: Standard JS DOM methods to find the "Next" button safely
        let nextPageUrl = "";
        let nextLink = document.querySelector(
          'a[rel="next"], .pagination .next a, .nav-next a, a.next, li.next a',
        );

        if (!nextLink) {
          const allLinks = Array.from(document.querySelectorAll("a"));
          nextLink = allLinks.find((a) => {
            const text = a.textContent.trim().toLowerCase();
            const href = a.getAttribute("href") || "";
            return (
              text === "next" ||
              text === "›" ||
              text === "»" ||
              text.includes("next page") ||
              (href.includes("page=") && text.length < 15)
            );
          });
        }

        if (
          nextLink &&
          nextLink.href &&
          !nextLink.href.includes("#") &&
          nextLink.href !== window.location.href
        ) {
          nextPageUrl = nextLink.href;
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
        `[greatugandajobs] page ${currentPage}: found ${jobs.length} jobs, ${newCount} new. Total: ${allCards.length}`,
      );

      if (newCount === 0 || !nextPageUrl) {
        console.error(
          "[greatugandajobs] no more pages or no new jobs. Stopping pagination.",
        );
        break;
      }

      await listPage.goto(nextPageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await new Promise((r) => setTimeout(r, 1500));
      currentPage++;
    }

    await listPage.close();
    console.error(
      `[greatugandajobs] total unique jobs found: ${allCards.length}. Fetching details...`,
    );

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

    const results = allCards.map((j, i) => {
      const d = details[i] || { description: "Not Specified" };

      return buildJobObject({
        title: j.title,
        location: j.location || "Uganda",
        industry_sector: j.industry_sector || "Not Specified",
        type: j.type || "Not Specified",
        amount: "Not Disclosed",
        time_added: j.time_added || new Date().toISOString(),
        description: d.description,
        url_link: j.url,
        employer: j.employer || "Not Specified",
      });
    });

    return results;
  } catch (err) {
    console.error("[greatugandajobs] scrape failed:", err.message);
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
