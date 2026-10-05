const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.brightermonday.co.ug/jobs";

function relativeToIso(text) {
  if (!text) return "";
  const now = new Date();
  const t = text.trim().toLowerCase();

  if (t === "today") return now.toISOString();

  const match = t.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const d = new Date(now);
    if (unit === "hour") d.setHours(d.getHours() - n);
    else if (unit === "day") d.setDate(d.getDate() - n);
    else if (unit === "week") d.setDate(d.getDate() - n * 7);
    else if (unit === "month") d.setMonth(d.getMonth() - n);
    return d.toISOString();
  }

  // Fallback: leave the raw text if we can't parse it (e.g. unexpected format)
  return text.trim();
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  try {
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector('div[data-cy="listing-cards-components"]', {
      timeout: 15000,
    });

    const rawJobs = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('div[data-cy="listing-cards-components"]'),
      );

      return cards.map((card) => {
        const linkEl = card.querySelector('a[data-cy="listing-title-link"]');
        const url = linkEl ? linkEl.href : "";
        const title = linkEl
          ? linkEl.getAttribute("title") || linkEl.textContent.trim()
          : "";

        // Company: first <p> with the text-blue-700 class, excluding the title link itself
        const companyP = Array.from(card.querySelectorAll("p")).find(
          (p) =>
            p.className.includes("text-blue-700") &&
            !p.closest('a[data-cy="listing-title-link"]'),
        );
        const company = companyP ? companyP.textContent.trim() : "";

        // Tag row: the flex-wrap/mt-3 div holding location/type/amount <span> pills
        const tagRow = Array.from(card.querySelectorAll("div")).find(
          (d) =>
            d.className.includes("flex-wrap") &&
            d.className.includes("mt-3") &&
            d.querySelector("span"),
        );
        const spans = tagRow
          ? Array.from(tagRow.querySelectorAll(":scope > span"))
          : [];
        const location = spans[0] ? spans[0].textContent.trim() : "";
        const type = spans[1] ? spans[1].textContent.trim() : "";
        const amountRaw = spans[2]
          ? spans[2].textContent.replace(/\s+/g, " ").trim()
          : "";

        // Sector: the <p> immediately following the tag row
        let industry_sector = "";
        if (
          tagRow &&
          tagRow.nextElementSibling &&
          tagRow.nextElementSibling.tagName === "P"
        ) {
          industry_sector = tagRow.nextElementSibling.textContent.trim();
        }

        // Posted date: <p> inside the "ml-auto" wrapper (e.g. "2 days ago", "Today")
        let posted = "";
        const mlAuto = Array.from(card.querySelectorAll("div")).find((d) =>
          d.className.includes("ml-auto"),
        );
        if (mlAuto) {
          const p = mlAuto.querySelector("p");
          if (p) posted = p.textContent.trim();
        }

        // Description: longest text-gray-700 <p> in the card (the summary blurb)
        const descCandidates = Array.from(card.querySelectorAll("p")).filter(
          (p) =>
            p.className.includes("text-gray-700") &&
            p.textContent.trim().length > 40,
        );
        const description = descCandidates.length
          ? descCandidates[descCandidates.length - 1].textContent.trim()
          : "";

        return {
          title,
          company,
          location,
          type,
          amountRaw,
          industry_sector,
          posted,
          description,
          url,
        };
      });
    });

    return rawJobs
      .filter((j) => j.url && j.title)
      .map((j) =>
        buildJobObject({
          title: j.title,
          location: j.location || "Not Specified",
          industry_sector: j.industry_sector || "Not Specified",
          type: j.type || "Not Specified",
          amount:
            /confidential/i.test(j.amountRaw) || !j.amountRaw
              ? "Not Disclosed"
              : j.amountRaw,
          time_added: relativeToIso(j.posted),
          description: j.description || "",
          url_link: j.url,
        }),
      );
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
