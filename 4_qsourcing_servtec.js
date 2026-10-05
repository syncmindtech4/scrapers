const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://qsourcing.com/jobs-in-uganda/";

async function scrape() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  try {
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector("li.job_listing", { timeout: 15000 });

    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("li.job_listing"));

      return cards.map((card) => {
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
      });
    });

    return rawJobs
      .filter((j) => j.url && j.title)
      .map((j) =>
        buildJobObject({
          title: j.title,
          location: j.location || "Not Specified",
          industry_sector: "Not Specified", // not exposed on the list page
          type: j.type || "Not Specified",
          amount: "Not Disclosed", // qsourcing never publishes salary on listings
          time_added: j.datetime ? `${j.datetime}T00:00:00.000Z` : "",
          description: "", // only available on the detail page; not fetched in this pass
          url_link: j.url,
        }),
      );
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
