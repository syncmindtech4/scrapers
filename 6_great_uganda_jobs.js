const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://www.greatugandajobs.com/jobs/";

function relativeToIso(text) {
  if (!text) return "";
  const t = text.trim().toLowerCase();
  const now = new Date();

  if (t === "today") return now.toISOString();

  const match = t.match(/(\d+)\s+days?\s+ago/);
  if (match) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(match[1], 10));
    return d.toISOString();
  }

  // Fallback: couldn't parse (e.g. "Yesterday" or an unexpected format) -- keep raw text
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
    await page.waitForSelector('a[href*="/jobs/job-detail/"]', {
      timeout: 15000,
    });

    const rawJobs = await page.evaluate(() => {
      const titleLinks = Array.from(
        document.querySelectorAll('a[href*="/jobs/job-detail/"]'),
      );

      return titleLinks.map((titleLink) => {
        // Climb up from the title link until we reach an ancestor whose text
        // contains the job's metadata labels (bounds the search to ~8 levels
        // so we don't accidentally swallow the whole page).
        let container = titleLink;
        for (let i = 0; i < 8; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          const text = container.innerText || "";
          if (text.includes("Job Category:") && text.includes("Duty Station:"))
            break;
        }

        const fullText = container.innerText || "";
        const title = titleLink.textContent.trim();
        const url = titleLink.href;

        // Company: the nearest company-detail link inside the same container;
        // its logo <img title="..."> carries the clean company name.
        const companyLink = container.querySelector(
          'a[href*="/company-detail/"]',
        );
        let company = "";
        if (companyLink) {
          const img = companyLink.querySelector("img");
          company = img
            ? (
                img.getAttribute("title") ||
                img.getAttribute("alt") ||
                ""
              ).trim()
            : companyLink.textContent.trim();
        }

        // Badges ("Full-timeNewGold1 Jobs") appear before "Job Category:" with no
        // separators, so pull out just the employment-type keyword.
        const badgeSegment = fullText.split("Job Category:")[0] || "";
        const typeMatch = badgeSegment.match(
          /(Full-time|Part-time|Internship|Contract|Temporary|Volunteer)/i,
        );

        const categoryMatch = fullText.match(/Job Category:\s*([^\n]+)/);
        const postedMatch = fullText.match(/Posted:\s*([^\n]+)/);
        const dutyMatch = fullText.match(/Duty Station:\s*([^\n]+)/);

        return {
          title,
          url,
          company,
          type: typeMatch ? typeMatch[1] : "",
          category: categoryMatch ? categoryMatch[1].trim() : "",
          posted: postedMatch ? postedMatch[1].trim() : "",
          duty: dutyMatch ? dutyMatch[1].trim() : "",
        };
      });
    });

    return rawJobs
      .filter((j) => j.url && j.title)
      .map((j) =>
        buildJobObject({
          title: j.title,
          location: j.duty || "Not Specified",
          industry_sector: j.category
            ? j.category.replace(/\s*jobs in uganda$/i, "").trim()
            : "Not Specified",
          type: j.type || "Not Specified",
          amount: "Not Disclosed", // not published on the list page
          time_added: relativeToIso(j.posted),
          description: "", // only on the detail page; not fetched in this pass
          url_link: j.url,
        }),
      );
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };
