/**
 * scrapers/generic_engine.js
 * A universal scraping engine for standard job boards (WordPress, WP Job Manager, etc.)
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
  normalizeCountry,
} = require("../_utils");

const DETAIL_CONCURRENCY = 3;
const MAX_DESC = 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Smart Sector Matcher (Reused from JobAdverts)
function matchSector(text) {
  const lower = " " + (text || "").toLowerCase() + " ";
  const sectors = [
    {
      k: [
        "dispatch",
        "delivery",
        "driver",
        "logistics",
        "supply chain",
        "warehouse",
        "transport",
        "fleet",
        "courier",
      ],
      v: "Logistics & Transport",
    },
    {
      k: [
        "bank",
        "finance",
        "loan",
        "credit",
        "insurance",
        "microfinance",
        "accountant",
        "cfo",
        "audit",
        "tax",
        "payroll",
      ],
      v: "Banking & Finance",
    },
    {
      k: [
        "health",
        "medical",
        "nurse",
        "doctor",
        "hospital",
        "pharma",
        "clinical",
        "physio",
        "wash",
        "hygiene",
      ],
      v: "Healthcare",
    },
    {
      k: [
        "software",
        "developer",
        "backend",
        "frontend",
        "data engineer",
        "ai",
        "system admin",
        "it support",
        "cyber",
        "erp",
      ],
      v: "IT & Technology",
    },
    {
      k: [
        "engineer",
        "construction",
        "civil",
        "mechanical",
        "electrical",
        "technician",
        "surveyor",
        "architect",
      ],
      v: "Engineering & Construction",
    },
    {
      k: [
        "sales",
        "marketing",
        "brand",
        "retail",
        "business development",
        "merchandiser",
      ],
      v: "Sales & Marketing",
    },
    {
      k: [
        "hr",
        "human resource",
        "recruit",
        "talent",
        "admin",
        "receptionist",
        "clerk",
      ],
      v: "Human Resources & Admin",
    },
    {
      k: [
        "teacher",
        "lecturer",
        "tutor",
        "education",
        "school",
        "training",
        "intern",
      ],
      v: "Education & Training",
    },
    {
      k: [
        "ngo",
        "program officer",
        "project officer",
        "meal",
        "monitoring",
        "humanitarian",
        "refugee",
        "protection",
      ],
      v: "NGO & Development",
    },
    {
      k: ["legal", "lawyer", "counsel", "paralegal", "compliance", "advocate"],
      v: "Legal",
    },
    { k: ["security", "guard", "surveillance", "safety"], v: "Security" },
    {
      k: ["agriculture", "farm", "livestock", "crop", "agronom", "poultry"],
      v: "Agriculture",
    },
    {
      k: ["hotel", "restaurant", "chef", "waiter", "tourism", "hospitality"],
      v: "Hospitality & Tourism",
    },
  ];
  for (const { k, v } of sectors) {
    if (new RegExp(`\\b(${k.join("|")})\\b`, "i").test(lower)) return v;
  }
  return "Not Specified";
}

async function scrapeGeneric(config) {
  const { sourceId, listUrl, maxPages = 5, country } = config;
  const { browser, context } = await launchBrowser();
  const allJobs = [];
  const seenUrls = new Set();

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);

    for (let p = 1; p <= maxPages; p++) {
      let targetUrl = listUrl;
      if (p > 1) {
        if (listUrl.includes("?")) targetUrl = `${listUrl}&paged=${p}`;
        else
          targetUrl = `${listUrl}${listUrl.endsWith("/") ? "" : "/"}page/${p}/`;
      }

      console.error(`[${sourceId}] scraping page ${p}: ${targetUrl}`);
      await listPage
        .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
      await sleep(2000);

      const jobs = await listPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        return links
          .filter((a) => {
            const href = a.href || "";
            const text = a.textContent.trim();
            // Heuristic: URL contains job-like keywords, text is long enough to be a title
            return (
              /(job|vacancy|position|listing|career|opportunity)s?[\-\/]/i.test(
                href,
              ) &&
              text.length > 15 &&
              !href.includes("/category/") &&
              !href.includes("/tag/") &&
              !/^(home|about|contact|login|register)$/i.test(text)
            );
          })
          .map((a) => ({
            url: a.href,
            title: a.textContent.trim().substring(0, 150),
          }));
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
        `[${sourceId}] page ${p}: found ${jobs.length} jobs, ${newCount} new.`,
      );
      if (newCount === 0 && p > 1) break;
      await sleep(1500);
    }

    await listPage.close();
    console.error(
      `[${sourceId}] Total unique: ${allJobs.length}. Fetching details...`,
    );

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
            const art = document.querySelector(
              "article, .entry-content, .job-description, main, .job-details",
            );
            const text = art ? art.innerText : document.body.innerText;

            let employer = "Not Specified";
            const empMatch = text.match(
              /(?:Company|Employer|Organization|Hiring Body|Recruiter)[:\s]+([^\n]+)/i,
            );
            if (empMatch) employer = empMatch[1].trim().substring(0, 60);

            let location = "Uganda";
            const locMatch = text.match(
              /(?:Location|Duty Station|Based in)[:\s]+([A-Za-z\s,\-]+)/i,
            );
            if (locMatch) location = locMatch[1].split(",")[0].trim();

            return { description: text.substring(0, 1000), employer, location };
          });
        } catch (e) {
          /* silent fail */
        } finally {
          await page.close();
          await sleep(500);
        }
      }
    }
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    return allJobs.map((j, i) => {
      const d = details[i] || {};
      const desc = d.description || "";
      return Object.assign(
        buildJobObject({
          title: j.title,
          url_link: j.url,
          employer: d.employer || "Not Specified",
          description: desc || "Not Specified",
          location: normalizeCountry(d.location || "Uganda", country),
          industry_sector: matchSector(desc + " " + j.title),
          type: "Not Specified",
          amount: "Not Disclosed",
          time_added: new Date().toISOString(),
        }),
        {
          country:
            country || normalizeCountry((d.location || "") + " " + j.title),
        },
      );
    });
  } catch (err) {
    console.error(`[${sourceId}] Fatal error:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeGeneric, matchSector };
