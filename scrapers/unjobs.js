/**
 * scrapers/unjobs_uganda.js (multi-country edition)
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");
const { matchSector } = require("./generic_engine");

const COUNTRY_SLUGS = {
  Uganda: "uganda",
  Kenya: "kenya",
  Tanzania: "tanzania",
  Rwanda: "rwanda",
  Ethiopia: "ethiopia",
  Ghana: "ghana",
  "South Sudan": "south-sudan",
};
const MAX_PAGES = 2;
const DETAIL_CONCURRENCY = 3;
const MAX_DESC = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeCountry(context, country, slug) {
  const listPage = await context.newPage();
  const jobs = [];
  const seen = new Set();
  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url =
        p === 1
          ? `https://unjobs.org/duty_stations/${slug}`
          : `https://unjobs.org/duty_stations/${slug}?page=${p}`;
      console.error(`[unjobs:${country}] page ${p}`);
      await listPage
        .goto(url, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {});
      await sleep(2000);
      const found = await listPage.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .filter((a) => {
            const t = a.textContent.trim(),
              h = a.href || "";
            return (
              t.length > 25 &&
              t.length < 200 &&
              h.split("/").length > 4 &&
              !h.includes("/duty_stations/") &&
              !h.includes("/organizations/") &&
              !h.includes("/tags/")
            );
          })
          .map((a) => ({
            url: a.href,
            title: a.textContent.trim().replace(/\s+/g, " "),
          })),
      );
      let newOnes = 0;
      for (const j of found)
        if (!seen.has(j.url)) {
          seen.add(j.url);
          jobs.push(j);
          newOnes++;
        }
      if (!newOnes) break;
      await sleep(1200);
    }
  } finally {
    await listPage.close();
  }
  console.error(`[unjobs:${country}] ${jobs.length} unique jobs`);

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
          const text = document.body.innerText;
          const org = text.match(/Organization[:\s]+([^\n]+)/i);
          return {
            employer: org ? org[1].trim() : "UN Agency",
            description: text.substring(0, 2500),
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
    const desc = d.description || "";
    let sector = matchSector(desc + " " + j.title);
    if (sector === "Not Specified") sector = "NGO & Development";
    return Object.assign(
      buildJobObject({
        title: j.title,
        url_link: j.url,
        employer: d.employer || "UN Agency",
        description: desc.substring(0, MAX_DESC) || "Not Specified",
        location: country,
        industry_sector: sector,
        type: "Not Specified",
        amount: "Not Disclosed",
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
    for (const [country, slug] of Object.entries(COUNTRY_SLUGS)) {
      try {
        all.push(...(await scrapeCountry(context, country, slug)));
      } catch (e) {
        console.error(`[unjobs:${country}] failed:`, e.message);
      }
    }
    return all;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
