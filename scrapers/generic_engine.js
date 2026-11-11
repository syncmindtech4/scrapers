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
  if (!text) return "Not Specified";
  const t = ` ${text.toLowerCase()} `;
  const rules = [
    {
      re: /\b(health|medical|nurse|doctor|hospital|pharma|clinical|physio|midwif|vaccin|hygiene|nutrition|cardiovascular)\b/,
      v: "Healthcare",
    },
    {
      re: /\b(hotel|restaurant|chef|waiter|waitress|barista|bartender|tourism|hospitality|housekeeping|cook|catering)\b/,
      v: "Hospitality & Tourism",
    },
    {
      re: /\b(dispatch rider|delivery rider|driver|courier|fleet|crane operator|fork ?lift)\b/,
      v: "Logistics & Transport",
    },
    {
      re: /\b(bank|finance|accountant|accounting|audit|tax|cfo|treasury|credit|loan|microfinance|payroll|underwriter|actuarial)\b/,
      v: "Banking & Finance",
    },
    {
      re: /\b(software|developer|backend|frontend|full[- ]stack|data engineer|data scientist|ai lead|machine learning|system admin|it support|cyber|erp|odoo|ict|information technology|network)\b/,
      v: "IT & Technology",
    },
    {
      re: /\b(engineer|construction|civil|mechanical|electrical|technician|surveyor|architect|welder|mason)\b/,
      v: "Engineering & Construction",
    },
    {
      re: /\b(sales|marketing|brand|retail|merchandis|promoter|business development|telesales)\b/,
      v: "Sales & Marketing",
    },
    {
      re: /\b(teacher|lecturer|tutor|education|school|training|intern|graduate trainee|apprentice|tutorial)\b/,
      v: "Education & Training",
    },
    {
      re: /\b(ngo|program officer|programme officer|project officer|meal|monitoring|evaluation|humanitarian|refugee|protection|safeguarding|community development)\b/,
      v: "NGO & Development",
    },
    {
      re: /\b(hr|human resource|people & culture|recruit|talent acquisition|admin|receptionist|clerk|office assistant|personal assistant|secretary)\b/,
      v: "Human Resources & Admin",
    },
    {
      re: /\b(legal|lawyer|counsel|paralegal|compliance|advocate|notary)\b/,
      v: "Legal",
    },
    { re: /\b(security|guard|surveillance|safety officer)\b/, v: "Security" },
    {
      re: /\b(agriculture|farm|livestock|crop|agronom|poultry|fishery|veterinary|forestry)\b/,
      v: "Agriculture",
    },
    {
      re: /\b(logistics|supply chain|warehouse|transport|procurement|purchasing|vendor|stores|inventory)\b/,
      v: "Logistics & Procurement",
    },
    {
      re: /\b(customer service|call centre|client relations|customer care)\b/,
      v: "Customer Service",
    },
  ];
  for (const { re, v } of rules) if (re.test(t)) return v;
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
