/**
 * scrapers/jobs_co_ug.js (Final Version)
 * Pure API scraper for jobs.co.ug (Strapi CMS backend)
 * Handles nested employer objects and strips HTML from descriptions.
 */
const { buildJobObject, normalizeCountry } = require("../_utils");
const { matchSector } = require("./generic_engine");

const API_URL = "https://cms.jobs.co.ug/api/jobs";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

// Helper to strip HTML tags and decode entities
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>?/gm, "") // Remove tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

async function scrape() {
  const allJobs = [];
  const seenIds = new Set();

  try {
    console.error(
      `[jobs_co_ug] Bypassing browser. Fetching directly from CMS API...`,
    );

    for (let p = 1; p <= MAX_PAGES; p++) {
      const fetchUrl = `${API_URL}?page=${p}&pageSize=${PAGE_SIZE}&populate=*`;

      const res = await fetch(fetchUrl);
      if (!res.ok) {
        console.error(
          `[jobs_co_ug] API returned status ${res.status}. Stopping.`,
        );
        break;
      }

      const json = await res.json();
      const jobs = json.data || [];

      if (jobs.length === 0) break;

      let newCount = 0;
      for (const j of jobs) {
        const id = j.documentId || j.id;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allJobs.push(j);
          newCount++;
        }
      }

      console.error(
        `[jobs_co_ug] page ${p}: fetched ${jobs.length} jobs, ${newCount} new.`,
      );
      if (jobs.length < PAGE_SIZE) break;
    }

    console.error(
      `[jobs_co_ug] Total unique jobs fetched: ${allJobs.length}. Mapping to schema...`,
    );

    return allJobs.map((j) => {
      // 1. Extract Employer Name from nested object
      let employerName = "Not Specified";
      if (j.employer && typeof j.employer === "object") {
        employerName =
          j.employer.companyName || j.employer.name || "Not Specified";
      } else if (typeof j.employer === "string") {
        employerName = j.employer;
      }

      // 2. Clean Description
      const rawDesc = j.description || j.content || "";
      const cleanDesc = stripHtml(rawDesc);

      const title = j.title || "Untitled Job";
      const location = j.location || j.city || "Uganda";
      const type = j.type || j.employment_type || "Not Specified";
      const salary = j.salary || j.amount || "Not Disclosed";

      // Build public URL from slug
      const slug = j.slug || "";
      const publicUrl = slug
        ? `https://jobs.co.ug/jobs/${slug}`
        : j.url_link || `https://jobs.co.ug/`;

      return Object.assign(
        buildJobObject({
          title: title,
          url_link: publicUrl,
          employer: employerName,
          description: cleanDesc.substring(0, 1500) || "Not Specified",
          location: location,
          // Run sector matching on the clean text
          industry_sector: matchSector(cleanDesc + " " + title),
          type: type,
          amount: salary,
          time_added: j.publishedAt || j.createdAt || new Date().toISOString(),
        }),
        {
          country: normalizeCountry(
            j.location || "",
            (j.employer && j.employer.country) || "Uganda",
          ),
        },
      );
    });
  } catch (err) {
    console.error(`[jobs_co_ug] Fatal error:`, err.message);
    return [];
  }
}

module.exports = { scrape };
