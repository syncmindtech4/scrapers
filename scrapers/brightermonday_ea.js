/**
 * scrapers/brightermonday_ea.js
 * One scraper for BrighterMonday Kenya, Tanzania, Rwanda.
 * Strict rule: only real job URLs (slug ending in a numeric ID) are accepted.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");
const { matchSector } = require("./generic_engine");

const COUNTRIES = {
  Kenya: "www.brightermonday.co.ke",
  Tanzania: "www.brightermonday.co.tz",
  Rwanda: "www.brightermonday.rw",
};
const JOB_URL_RE = /\/jobs\/[a-z0-9-]+-\d{4,}\/?$/i;
const MAX_PAGES = 3;
const DETAIL_CONCURRENCY = 3;
const MAX_DESC = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeCountry(context, country, domain) {
  const listPage = await context.newPage();
  const jobs = [];
  const seen = new Set();
  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://${domain}/jobs?page=${p}`;
      console.error(`[bm:${country}] page ${p}`);
      const resp = await listPage
        .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => null);
      if (!resp || resp.status() >= 400) break;
      await sleep(2500);

      const found = await listPage.evaluate((reSrc) => {
        const re = new RegExp(reSrc, "i");
        return Array.from(document.querySelectorAll("a[href]"))
          .filter((a) => re.test(a.href))
          .map((a) => {
            const card = a.closest("li, article, div[class*='job']") || a;
            return {
              url: a.href.split("?")[0],
              title: a.textContent.trim().replace(/\s+/g, " "),
              snippet: (card.innerText || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 400),
            };
          });
      }, JOB_URL_RE.source);

      let newOnes = 0;
      for (const j of found)
        if (!seen.has(j.url)) {
          seen.add(j.url);
          jobs.push(j);
          newOnes++;
        }
      if (!newOnes) break;
      await sleep(1500);
    }
  } finally {
    await listPage.close();
  }
  console.error(`[bm:${country}] ${jobs.length} unique job links`);

  const details = new Array(jobs.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const i = idx++;
      const page = await context.newPage();
      try {
        await blockHeavyResources(page);
        await page.goto(jobs[i].url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        details[i] = await page.evaluate(() => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const main =
            document.querySelector(
              "main, article, .job-details, .entry-content",
            ) || document.body;
          const text = main.innerText || "";
          const emp = text.match(
            /(?:Company|Employer|Organisation|Organization)\s*[:\n]\s*([A-Za-z][^\n]{2,60})/i,
          );
          const loc = text.match(
            /(?:Location|Duty Station|Place of work)\s*[:\n]\s*([^\n]{3,50})/i,
          );
          const typ = text.match(
            /(Full[- ]time|Part[- ]time|Contract|Internship|Temporary|Freelance)/i,
          );
          const sal = text.match(
            /(?:Salary|Pay|Remuneration)\s*[:\n]\s*([^\n]{3,60})/i,
          );
          return {
            employer: emp ? clean(emp[1]) : "Not Specified",
            location: loc ? clean(loc[1]).split(",")[0] : "",
            type: typ ? typ[1] : "Not Specified",
            amount: sal ? clean(sal[1]) : "Not Disclosed",
            description: text.slice(0, 2500),
          };
        });
      } catch (e) {
        /* skip */
      } finally {
        await page.close();
        await sleep(400);
      }
    }
  }
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

  return jobs.map((j, i) => {
    const d = details[i] || {};
    const desc = (d.description || j.snippet || "").slice(0, MAX_DESC);
    return Object.assign(
      buildJobObject({
        title: j.title,
        url_link: j.url,
        employer: d.employer || "Not Specified",
        description: desc || "Not Specified",
        location: d.location || country,
        industry_sector: matchSector(desc + " " + j.title),
        type: d.type || "Not Specified",
        amount: d.amount || "Not Disclosed",
        time_added: new Date().toISOString(),
      }),
      { country },
    );
  });
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  try {
    const all = [];
    for (const [country, domain] of Object.entries(COUNTRIES)) {
      try {
        all.push(...(await scrapeCountry(context, country, domain)));
      } catch (e) {
        console.error(`[bm:${country}] failed:`, e.message);
      }
    }
    return all;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
