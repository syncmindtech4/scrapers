/**
 * jobadverts_ug.js (v3 — Hygiene patched + multi-country)
 * JobAdverts Uganda — https://jobadverts.ug/jobs/
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");
const { matchSector } = require("./generic_engine");

const BASE_URL = "https://jobadverts.ug/jobs/";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 600;
const MAX_DESC = 1200;
const MAX_PAGES = 5;

// Strict city-only regex — rejects garbage locations pulled from description text
const CITY_RE =
  /(Kampala|Entebbe|Jinja|Mbarara|Gulu|Mbale|Wakiso|Hoima|Lira|Arua|Fort Portal|Mukono|Masaka|Soroti|Kabale|Busia|Namanve|Kapeeka|Adjumani|Isingiro|Terego|Kasese|Moroto|Nakivale|Kiruhura|Mitooma|Amuria|Multiple locations|Across Uganda|Remote|Uganda)/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Strip HTML tags, entities, and collapse whitespace
function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page
      .waitForSelector("article.entry-content, .entry-content", {
        timeout: 10000,
      })
      .catch(() => {});

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        const article = document.querySelector("article");
        if (!article) return null;

        let title = "";
        let employer = "Not Specified";

        const h1 = article.querySelector("h1");
        if (h1) title = clean(h1.textContent);

        const strongTags = Array.from(article.querySelectorAll("strong"));
        if (strongTags.length > 0) {
          for (const s of strongTags) {
            const txt = clean(s.textContent);
            if (
              txt &&
              txt.length > 2 &&
              txt.length < 60 &&
              !txt.includes("Apply") &&
              !txt.includes("Deadline") &&
              !txt.includes("Job Purpose") &&
              !txt.includes("Requirements")
            ) {
              employer = txt;
              break;
            }
          }
        }

        const contentDiv = article.querySelector(".entry-content");
        let description = "";

        if (contentDiv) {
          const clone = contentDiv.cloneNode(true);
          clone
            .querySelectorAll("img, script, style, iframe, nav, footer")
            .forEach((el) => el.remove());
          description = clean(clone.innerText);
        }

        if (!description || description.length < 50) {
          description = clean(article.innerText).slice(0, MAX_DESC * 2);
        }

        let type = "Not Specified";
        const typeRegex =
          /(Full[- ]Time|Part[- ]Time|Contract|Internship|Temporary|Volunteer|Remote|Freelance)/i;
        const typeMatch =
          description.match(typeRegex) || title.match(typeRegex);
        if (typeMatch) type = typeMatch[1];

        let time_added = new Date().toISOString();
        const dateMatch =
          description.match(/Posted[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
          description.match(/Date[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
          description.match(/Deadline[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) time_added = parsed.toISOString();
        }

        return {
          title: title || "",
          employer: employer || "Not Specified",
          description: description.slice(0, MAX_DESC * 2) || "Not Specified",
          type: type || "Not Specified",
          time_added: time_added,
        };
      },
      { MAX_DESC },
    );
  } catch (e) {
    console.error(`[jobadverts] Detail fetch failed for ${url}:`, e.message);
    return null;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allJobs = [];
  const seenUrls = new Set();

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);

    for (let p = 1; p <= MAX_PAGES; p++) {
      const targetUrl = p === 1 ? BASE_URL : `${BASE_URL}?page=${p}`;
      console.error(`[jobadverts] scraping page ${p}: ${targetUrl}`);

      await listPage.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      await listPage
        .waitForSelector(".jb-job-list-row", { timeout: 15000 })
        .catch(() => {});

      const jobs = await listPage.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const cards = Array.from(document.querySelectorAll(".jb-job-list-row"));

        return cards
          .map((card) => {
            const linkEl = card.querySelector("a.jb-job-title-link");
            if (!linkEl) return null;
            const url = linkEl.href;
            const title = clean(linkEl.textContent);
            let location = "Uganda";
            const locSpan = card.querySelector(
              ".jb-job-location, [class*='location'] span",
            );
            if (locSpan) location = clean(locSpan.textContent);
            return { title, url, location };
          })
          .filter((j) => j && j.url && j.title);
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
        `[jobadverts] page ${p}: found ${jobs.length} jobs, ${newCount} new. Total: ${allJobs.length}`,
      );

      if (newCount === 0) {
        console.error("[jobadverts] no new jobs found. Stopping pagination.");
        break;
      }

      await sleep(1500);
    }

    await listPage.close();
    console.error(
      `[jobadverts] total unique jobs found: ${allJobs.length}. Fetching details...`,
    );

    const details = new Array(allJobs.length).fill(null);
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < allJobs.length) {
        const i = nextIdx++;
        details[i] = await scrapeDetail(context, allJobs[i].url);
        await sleep(DETAIL_DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // PHASE 3: Merge, sanitize, and tag with country
    return allJobs.map((j, i) => {
      const d = details[i];

      const rawTitle = (d && d.title) || j.title || "";
      const rawDesc = (d && d.description) || "Not Specified";
      const combined = stripHtml(rawDesc) + " " + rawTitle;

      // --- PATCH 1: Strip HTML from description ---
      const description =
        stripHtml(rawDesc).slice(0, MAX_DESC) || "Not Specified";

      // --- PATCH 2: Strict location validator ---
      const rawLoc = (d && d.location) || j.location || "";
      const locMatch = (rawLoc + " " + description).match(CITY_RE);
      const location = locMatch ? locMatch[1] : "Uganda";

      // --- PATCH 3: Shared sector matcher (word-boundary safe) ---
      const industry_sector = matchSector(combined);

      const base = buildJobObject({
        title: rawTitle,
        url_link: j.url,
        employer: (d && d.employer) || "Not Specified",
        description,
        location,
        industry_sector,
        type: (d && d.type) || "Not Specified",
        amount: "Not Disclosed",
        time_added: (d && d.time_added) || new Date().toISOString(),
      });

      // --- PATCH 4: Multi-country tag ---
      return Object.assign(base, { country: "Uganda" });
    });
  } catch (err) {
    console.error("[jobadverts] scrape failed:", err.message);
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
