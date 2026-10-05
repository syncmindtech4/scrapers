const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.impactpool.org/search?q=Uganda";

async function scrape() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  try {
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Not actually Cloudflare-blocked -- confirmed real listing HTML in latest debug run.
    await page.waitForSelector('div.job a[data-turbo-frame="_top"]', {
      timeout: 15000,
    });

    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("div.job")).filter(
        (c) => c.querySelector('a[data-turbo-frame="_top"]'),
      );

      return cards.map((card) => {
        const a = card.querySelector('a[data-turbo-frame="_top"]');
        const url = a ? a.href : "";

        const h3 = card.querySelector('h3[type="cardTitle"]');
        const title = h3 ? h3.textContent.trim() : "";

        const bodyEmphasisDivs = Array.from(
          card.querySelectorAll('div[type="bodyEmphasis"]'),
        );

        // First bodyEmphasis div (dark text, #1C1B16) is the organization name
        const companyDiv = bodyEmphasisDivs.find((d) => {
          const style = d.getAttribute("style") || "";
          return style.includes("1C1B16");
        });
        const company = companyDiv ? companyDiv.textContent.trim() : "";

        // Location div has style color #63625B
        const locationDiv = bodyEmphasisDivs.find((d) => {
          const style = d.getAttribute("style") || "";
          return style.includes("63625B");
        });
        const location = locationDiv ? locationDiv.textContent.trim() : "";

        // Seniority/type div has style color #75736C
        const typeDiv = bodyEmphasisDivs.find((d) => {
          const style = d.getAttribute("style") || "";
          return style.includes("75736C");
        });
        const type = typeDiv ? typeDiv.textContent.trim() : "";

        return { title, company, location, type, url };
      });
    });

    return rawJobs
      .filter((j) => j.url && j.title)
      .map((j) =>
        buildJobObject({
          title: j.title,
          location: j.location || "Not Specified",
          industry_sector: "Not Specified", // Impactpool doesn't expose sector on the list page
          type: j.type || "Not Specified",
          amount: "Not Specified", // Impactpool (UN/NGO jobs) never publishes salary on listings
          time_added: "", // not shown on list page; would need a detail-page fetch like ReliefWeb
          description: "", // same as above
          url_link: j.url,
        }),
      );
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
