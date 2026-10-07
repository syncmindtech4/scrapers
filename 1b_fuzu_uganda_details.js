/**
 * 1b_fuzu_uganda_details.js
 * Enriches listing jobs with sector / type / salary / employer from each
 * job's own detail page.
 *
 * Strategy per job page:
 *   1. Look for <script type="application/ld+json"> containing a JobPosting
 *      (possibly inside an @graph array). Pull employmentType, baseSalary,
 *      hiringOrganization, industry/occupationalCategory, datePosted from it.
 *   2. If no JobPosting is found, fall back to regex over the visible page
 *      text (same heuristics as the listing scraper, just on more text).
 *
 * Usage:
 *   node 1b_fuzu_uganda_details.js            // full run
 *   node 1b_fuzu_uganda_details.js 5          // only first 5 jobs (testing)
 *   DEBUG_FUZU_DETAIL=1 node 1b_fuzu_uganda_details.js 1
 */

const fs = require("fs");
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");
const { scrape: scrapeListing } = require("./1_fuzu_uganda");

const CONCURRENCY = 3; // be polite — parallel tabs hitting job pages
const NAV_TIMEOUT = 30000;

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Walks a JSON-LD payload (object, array, or {@graph:[...]}) and returns
// every node whose @type includes "JobPosting".
function findJobPostings(parsed) {
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("JobPosting")) nodes.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  visit(parsed);
  return nodes;
}

function salaryFromJsonLd(baseSalary) {
  if (!baseSalary) return "";
  try {
    const val = baseSalary.value || baseSalary;
    const currency = baseSalary.currency || "";
    if (val && (val.value || val.minValue)) {
      const amt = val.value || `${val.minValue}-${val.maxValue}`;
      const unit = val.unitText ? `/${val.unitText.toLowerCase()}` : "";
      return clean(`${currency} ${amt}${unit}`);
    }
    if (typeof val === "number" || typeof val === "string") {
      return clean(`${currency} ${val}`);
    }
  } catch (e) {}
  return "";
}

async function extractFromJsonLd(page) {
  const blobs = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => s.textContent || "",
    ),
  );

  for (const raw of blobs) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    const postings = findJobPostings(parsed);
    if (!postings.length) continue;

    const jp = postings[0];
    const employer = jp.hiringOrganization?.name || "";
    const employmentType = Array.isArray(jp.employmentType)
      ? jp.employmentType.join(", ")
      : jp.employmentType || "";
    const sector = jp.industry || jp.occupationalCategory || "";
    const amount = salaryFromJsonLd(jp.baseSalary);
    const locality =
      jp.jobLocation?.address?.addressLocality ||
      jp.jobLocation?.address?.addressRegion ||
      "";
    const posted = jp.datePosted || "";

    return {
      found: true,
      employer: clean(employer),
      type: clean(employmentType),
      sector: clean(sector),
      amount,
      location: clean(locality),
      posted,
    };
  }
  return { found: false };
}

async function extractFromDom(page) {
  const text = await page.evaluate(() => document.body.innerText || "");
  const lines = text.split("\n").map(clean).filter(Boolean);

  const find = (re, maxLen = 90) =>
    lines.find((l) => re.test(l) && l.length <= maxLen) || "";

  const type = find(
    /full[- ]?time|part[- ]?time|contract|internship|consultan|volunteer|temporary|permanent|fixed[- ]term/i,
    60,
  );
  const amount = find(/ugx|ushs|usd|\$|salary/i, 60);
  const sector = find(
    /accounting|finance|banking|insurance|agriculture|construction|engineering|health|education|ngo|logistics|sales|marketing|hospitality|manufacturing|it\b|technology/i,
    60,
  );

  return {
    found: false,
    type,
    amount,
    sector,
    employer: "",
    location: "",
    posted: "",
  };
}

async function enrichJob(context, job, debug) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(job.url_link, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(800);

    let info = await extractFromJsonLd(page);
    if (debug) {
      console.error(`[DEBUG_FUZU_DETAIL] ${job.url_link}`);
      console.error(`  json-ld found: ${info.found}`, info);
    }
    if (!info.found) {
      const domInfo = await extractFromDom(page);
      if (debug) console.error(`  dom fallback:`, domInfo);
      info = {
        ...domInfo,
        ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)),
      };
    }

    return {
      ...job,
      industry_sector:
        info.sector && info.sector !== "Not Specified"
          ? info.sector
          : job.industry_sector,
      type: info.type || job.type,
      amount: info.amount || job.amount,
      employer: info.employer || "",
      location: info.location || job.location,
    };
  } catch (err) {
    console.error(`[detail] failed for ${job.url_link}: ${err.message}`);
    return job; // keep listing data if detail fetch fails
  } finally {
    await page.close();
  }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runner),
  );
  return results;
}

async function scrapeWithDetails(limit) {
  const listing = await scrapeListing();
  const jobs = limit ? listing.slice(0, limit) : listing;
  const debug = process.env.DEBUG_FUZU_DETAIL === "1";

  const { browser, context } = await launchBrowser();
  let enriched = [];
  try {
    enriched = await runPool(
      jobs,
      (job) => enrichJob(context, job, debug),
      CONCURRENCY,
    );
  } finally {
    await browser.close();
  }

  return enriched.map((r) =>
    buildJobObject({
      title: r.title,
      location: r.location,
      industry_sector: r.industry_sector,
      type: r.type,
      amount: r.amount,
      time_added: r.time_added,
      description: r.description,
      url_link: r.url_link,
      employer: r.employer, // only kept if buildJobObject accepts extra fields
    }),
  );
}

module.exports = { scrapeWithDetails };

if (require.main === module) {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  scrapeWithDetails(limit).then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nTotal jobs enriched: ${data.length}`);
  });
}
