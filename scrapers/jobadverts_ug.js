/**
 * jobadverts_ug.js (v2 — JB Theme Specific Selectors)
 * JobAdverts Uganda — https://jobadverts.ug/jobs/
 *
 * Key Findings from Debug:
 * - Container: .jb-job-list-row
 * - Link: a.jb-job-title-link
 * - Pagination: Site loads 200 items per page by default.
 *   We will still loop pages just in case, but expect large batches.
 */
const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("../_utils");

const BASE_URL = "https://jobadverts.ug/jobs/";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 600;
const MAX_DESC = 800;
const MAX_PAGES = 5; // Since it loads 200/page, 5 pages = 1000 jobs max cap

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page
      .waitForSelector("article.entry-content, .entry-content", {
        timeout: 10000,
      })
      .catch(() => {});

    return await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        const article = document.querySelector("article");
        if (!article) return null;

        let title = "";
        let employer = "Not Specified";

        const h1 = article.querySelector("h1");
        if (h1) title = clean(h1.textContent);

        const strongTags = Array.from(article.querySelectorAll("strong"));
        if (strongTags.length > 0) {
          for (const s of strongTags) {
            const txt = clean(s.textContent);
            if (
              txt &&
              txt.length > 2 &&
              txt.length < 60 &&
              !txt.includes("Apply") &&
              !txt.includes("Deadline")
            ) {
              employer = txt;
              break;
            }
          }
        }

        const contentDiv = article.querySelector(".entry-content");
        let description = "";

        if (contentDiv) {
          const clone = contentDiv.cloneNode(true);
          clone
            .querySelectorAll("img, script, style, iframe, nav, footer")
            .forEach((el) => el.remove());
          description = clean(clone.innerText);
        }

        if (!description || description.length < 50) {
          description = clean(article.innerText).slice(0, MAX_DESC);
        }

        let location = "Uganda";
        const locMatch =
          description.match(/Location[:\s]+([A-Za-z\s,\-]+)/i) ||
          description.match(/Based in ([A-Za-z\s,\-]+)/i) ||
          description.match(/Work location[:\s]+([A-Za-z\s,\-]+)/i);
        if (locMatch) {
          location = locMatch[1].split(",")[0].trim();
        } else {
          const cities = [
            "Kampala",
            "Entebbe",
            "Gulu",
            "Mbarara",
            "Jinja",
            "Wakiso",
            "Arua",
            "Mbale",
            "Fort Portal",
            "Mukono",
            "Hoima",
            "Lira",
          ];
          const foundCity = cities.find((c) => description.includes(c));
          if (foundCity) location = foundCity;
        }

        // --- IMPROVED SECTOR MATCHING WITH WORD BOUNDARIES ---
        let industry_sector = "Not Specified";
        const lowerDesc = " " + description.toLowerCase() + " "; // Pad with spaces for boundary matching

        // Order matters: Check more specific/longer phrases first
        const sectorKeywords = [
          {
            k: [
              "dispatch rider",
              "delivery rider",
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
              "vet",
              "wASH",
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
              "full stack",
              "data engineer",
              "ai lead",
              "system admin",
              "it support",
              "cyber",
              "erp",
              "odoo",
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
              "promoter",
            ],
            v: "Sales & Marketing",
          },
          {
            k: [
              "hr",
              "human resource",
              "recruit",
              "talent",
              "people & culture",
              "admin",
              "receptionist",
              "clerk",
              "office assistant",
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
              "graduate trainee",
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
              "evaluation",
              "humanitarian",
              "refugee",
              "protection",
            ],
            v: "NGO & Development",
          },
          {
            k: [
              "legal",
              "lawyer",
              "counsel",
              "paralegal",
              "compliance",
              "advocate",
            ],
            v: "Legal",
          },
          {
            k: ["security", "guard", "surveillance", "safety officer"],
            v: "Security",
          },
          {
            k: [
              "agriculture",
              "farm",
              "livestock",
              "crop",
              "agronom",
              "poultry",
              "fishery",
            ],
            v: "Agriculture",
          },
          {
            k: [
              "hotel",
              "restaurant",
              "chef",
              "waiter",
              "tourism",
              "hospitality",
              "barista",
              "cook",
            ],
            v: "Hospitality & Tourism",
          },
          {
            k: ["procurement", "purchasing", "supply", "vendor"],
            v: "Procurement",
          },
          {
            k: [
              "customer service",
              "call centre",
              "client relations",
              "support",
            ],
            v: "Customer Service",
          },
        ];

        for (const { k, v } of sectorKeywords) {
          // Use regex with word boundaries (\b) to avoid matching "it" inside "with"
          const pattern = new RegExp(`\\b(${k.join("|")})\\b`, "i");
          if (pattern.test(lowerDesc)) {
            industry_sector = v;
            break;
          }
        }

        // Special override for "Dispatch Rider" / "Delivery" based on Title if description fails
        if (
          industry_sector === "Not Specified" ||
          industry_sector === "IT & Technology"
        ) {
          if (/dispatch|delivery|rider|driver|courier/i.test(title)) {
            industry_sector = "Logistics & Transport";
          }
        }

        let type = "Not Specified";
        const typeRegex =
          /(Full[- ]Time|Part[- ]Time|Contract|Internship|Temporary|Volunteer|Remote|Freelance)/i;
        const typeMatch =
          description.match(typeRegex) || title.match(typeRegex);
        if (typeMatch) type = typeMatch[1];

        let time_added = new Date().toISOString();
        const dateMatch =
          description.match(/Posted[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
          description.match(/Date[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i) ||
          description.match(/Deadline[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) time_added = parsed.toISOString();
        }

        return {
          title: title || "",
          employer: employer || "Not Specified",
          location: location || "Uganda",
          industry_sector: industry_sector || "Not Specified",
          type: type || "Not Specified",
          amount: "Not Disclosed",
          description: description.slice(0, MAX_DESC) || "Not Specified",
          time_added: time_added,
        };
      },
      { MAX_DESC },
    );
  } catch (e) {
    console.error(`[jobadverts] Detail fetch failed for ${url}:`, e.message);
    return null;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allJobs = [];
  const seenUrls = new Set();

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);

    // PHASE 1: List Scraping
    for (let p = 1; p <= MAX_PAGES; p++) {
      // Note: JB theme often uses AJAX or simple ?page=N.
      // Based on debug, data-page="1" suggests standard param works.
      const targetUrl = p === 1 ? BASE_URL : `${BASE_URL}?page=${p}`;
      console.error(`[jobadverts] scraping page ${p}: ${targetUrl}`);

      await listPage.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      }); // networkidle helps ensure JS-loaded rows appear

      // Wait specifically for the JB rows
      await listPage
        .waitForSelector(".jb-job-list-row", { timeout: 15000 })
        .catch(() => {});

      const jobs = await listPage.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        // TARGET THE EXACT CLASS FROM DEBUG OUTPUT
        const cards = Array.from(document.querySelectorAll(".jb-job-list-row"));

        return cards
          .map((card) => {
            const linkEl = card.querySelector("a.jb-job-title-link");
            if (!linkEl) return null;

            const url = linkEl.href;
            const title = clean(linkEl.textContent);

            // Try to grab location/type from list view if available (often sparse in JB theme)
            // But primarily we rely on Detail Page enrichment now.
            let location = "Uganda";
            const locSpan = card.querySelector(
              ".jb-job-location, [class*='location'] span",
            );
            if (locSpan) location = clean(locSpan.textContent);

            return { title, url, location };
          })
          .filter((j) => j && j.url && j.title);
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
        `[jobadverts] page ${p}: found ${jobs.length} jobs, ${newCount} new. Total: ${allJobs.length}`,
      );

      // If no new jobs, break
      if (newCount === 0) {
        console.error("[jobadverts] no new jobs found. Stopping pagination.");
        break;
      }

      await sleep(1500);
    }

    await listPage.close();
    console.error(
      `[jobadverts] total unique jobs found: ${allJobs.length}. Fetching details...`,
    );

    // PHASE 2: Concurrent Detail Enrichment
    const details = new Array(allJobs.length).fill(null);
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < allJobs.length) {
        const i = nextIdx++;
        details[i] = await scrapeDetail(context, allJobs[i].url);
        await sleep(DETAIL_DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    // PHASE 3: Merge and Map
    // PHASE 3: Merge and Map
    return allJobs.map((j, i) => {
      const d = details[i];

      // If detail scraping failed, fallback to basic list data
      if (!d) {
        return buildJobObject({
          title: j.title,
          location: j.location || "Uganda",
          industry_sector: "Not Specified",
          type: "Not Specified",
          amount: "Not Disclosed",
          time_added: new Date().toISOString(),
          description: "Details unavailable.",
          url_link: j.url,
          employer: "Not Specified",
        });
      }

      return buildJobObject({
        title: d.title || j.title,
        location: d.location || j.location || "Uganda",
        industry_sector: d.industry_sector || "Not Specified",
        type: d.type || "Not Specified",
        amount: d.amount || "Not Disclosed",
        time_added: d.time_added || new Date().toISOString(),
        description: d.description || "Not Specified",
        url_link: d.url_link || j.url,
        employer: d.employer || "Not Specified",
      });
    });
  } catch (err) {
    console.error("[jobadverts] scrape failed:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
    console.log(`\n✅ Total jobs scraped: ${data.length}`);
  });
}
