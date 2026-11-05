/**
 * scrapers/accaglobal.js (multi-country edition)
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
  Ghana: "ghana",
  Ethiopia: "ethiopia",
};
const MAX_PAGES = 3;
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
          ? `https://jobs.accaglobal.com/jobs/${slug}/`
          : `https://jobs.accaglobal.com/jobs/${slug}/?page=${p}`;
      console.error(`[accaglobal:${country}] page ${p}`);
      await listPage
        .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
      await sleep(2000);

      const found = await listPage.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/job/"]'))
          .filter((a) => /\/job\/\d+\//.test(a.href))
          .map((a) => ({
            url: a.href.split("?")[0],
            title: a.textContent.trim().replace(/\s+/g, " "),
          }))
          .filter((j) => j.title.length > 5 && !/view details/i.test(j.title)),
      );
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
  console.error(`[accaglobal:${country}] ${jobs.length} unique jobs`);

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
        await page
          .evaluate(() => {
            const b = document.querySelector(
              'button[aria-label="Dismiss"], #onetrust-accept-btn-handler, .ccc-accept-button',
            );
            if (b) b.click();
          })
          .catch(() => {});

        details[i] = await page.evaluate(() => {
          const t = document.body.innerText;
          const emp =
            t.match(/Employer\s*\n?\s*([^\n]+)/i) ||
            t.match(/Company\s*\n?\s*([^\n]+)/i);
          const loc = t.match(/Location\s*\n?\s*([^\n]+)/i);
          const posted = t.match(/Posted\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
          const start = t.search(
            /Job Details|Job Description|Company Description|About the Role|Who We Are/i,
          );
          let desc =
            start > -1
              ? t.substring(start, start + 3000)
              : t.substring(0, 2000);
          desc = desc
            .replace(/Apply \(This will open in a new window.*?/gis, "")
            .replace(/Save jobClick to add.*?/gis, "")
            .replace(/You need to sign in.*?/gis, "")
            .replace(/View more categoriesView fewer categories/gis, "");
          return {
            employer: emp ? emp[1].trim() : "Not Specified",
            location: loc ? loc[1].trim().split(",")[0] : "",
            posted: posted ? posted[1] : "",
            description: desc.trim(),
          };
        });
      } catch (e) {
        /* skip */
      } finally {
        await page.close();
        await sleep(500);
      }
    }
  }
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

  return jobs.map((j, i) => {
    const d = details[i] || {};
    const desc = d.description || "";
    let time_added = new Date().toISOString();
    if (d.posted) {
      const p = new Date(d.posted);
      if (!isNaN(p.getTime())) time_added = p.toISOString();
    }
    return Object.assign(
      buildJobObject({
        title: j.title.replace(/^View details\s*/i, "").trim(),
        url_link: j.url,
        employer: d.employer || "Not Specified",
        description: desc.substring(0, MAX_DESC) || "Not Specified",
        location: d.location || country,
        industry_sector: matchSector(desc + " " + j.title),
        type: "Not Specified",
        amount: "Not Disclosed",
        time_added,
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
        console.error(`[accaglobal:${country}] failed:`, e.message);
      }
    }
    return all;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
