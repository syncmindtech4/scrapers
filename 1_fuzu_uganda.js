// /**
//  * 1_fuzu_uganda.js  (v2)
//  * Fuzu Uganda jobs — https://www.fuzu.com/uganda/job
//  *
//  * Built from debug_dom.js output:
//  *  - Card:        div.b2c-card   (other classes are hashed styled-components; don't use them)
//  *  - Job id:      card @id
//  *  - Description: card @description attribute (HTML string) -> stripped to text
//  *  - Title/link:  h2 a  (href like /uganda/jobs/<slug>)
//  *  - Location / type / salary / posted / sector: NOT yet confirmed. Best-effort text
//  *    heuristics are used. Run with DEBUG_FUZU=1 to print the first card's text lines
//  *    and HTML so exact selectors can be written.
//  */

// const {
//   launchBrowser,
//   blockHeavyResources,
//   buildJobObject,
// } = require("./_utils");

// const TARGET_URL = "https://www.fuzu.com/uganda/job";
// const CARD_SELECTOR = "div.b2c-card";
// const MAX_DESC = 400;

// function toIso(text) {
//   if (!text) return "";
//   const t = String(text)
//     .replace(/^posted:?\s*/i, "")
//     .trim();
//   const d = new Date(t + (/\d{4}-\d{2}-\d{2}T/.test(t) ? "" : " UTC"));
//   return isNaN(d) ? t : d.toISOString();
// }

// async function scrape() {
//   const { browser, context } = await launchBrowser();
//   let results = [];

//   try {
//     const page = await context.newPage();
//     await blockHeavyResources(page);
//     await page.goto(TARGET_URL, {
//       waitUntil: "domcontentloaded",
//       timeout: 45000,
//     });
//     await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 });
//     await page.waitForTimeout(1500);

//     const debug = process.env.DEBUG_FUZU === "1";

//     const raw = await page.evaluate(
//       ({ CARD_SELECTOR, MAX_DESC, debug }) => {
//         const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
//         const stripHtml = (html) => {
//           const d = document.createElement("div");
//           d.innerHTML = html || "";
//           return clean(d.textContent);
//         };
//         const out = [];
//         const seen = new Set();
//         let debugDone = false;

//         for (const card of document.querySelectorAll(CARD_SELECTOR)) {
//           try {
//             const a = card.querySelector("h2 a[href]");
//             if (!a) continue;
//             const href = a.href;
//             if (seen.has(href)) continue;
//             seen.add(href);

//             const title = clean(a.textContent);
//             const lines = (card.innerText || "")
//               .split("\n")
//               .map(clean)
//               .filter((l) => l && l !== title);

//             const find = (re, maxLen = 90) =>
//               lines.find((l) => re.test(l) && l.length <= maxLen) || "";

//             const catLink = card.querySelector('a[href*="/uganda/job/"]');
//             const locLink = catLink ? clean(catLink.textContent) : "";
//             const location = (
//               locLink ||
//               find(
//                 /district|kampala|uganda|remote|wakiso|entebbe|gulu|mbarara|jinja|mukono|lira|arua|mbale|fort portal/i,
//               )
//             ).replace(/^[•·\-\s]+/, "");
//             const type = find(
//               /full[- ]?time|part[- ]?time|contract|internship|consultan|volunteer|temporary|permanent|fixed[- ]term/i,
//               60,
//             );
//             const amount = find(/ugx|ushs|usd|\$|salary/i, 60);
//             const timeEl = card.querySelector("time");
//             const posted = timeEl
//               ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
//               : find(/\bago\b|posted|today|yesterday/i, 40);
//             const sector = ""; // not confirmed yet; needs DEBUG_FUZU output

//             const desc = stripHtml(card.getAttribute("description")).slice(
//               0,
//               MAX_DESC,
//             );

//             if (debug && !debugDone) {
//               debugDone = true;
//               const clone = card.cloneNode(true);
//               clone.removeAttribute("description");
//               console.log(
//                 "[DEBUG_FUZU] text lines:",
//                 JSON.stringify(lines, null, 2),
//               );
//               console.log("[DEBUG_FUZU] html:", clone.outerHTML.slice(0, 2500));
//             }

//             out.push({
//               id: card.id,
//               title,
//               href,
//               location,
//               type,
//               amount,
//               posted,
//               sector,
//               desc,
//             });
//           } catch (e) {
//             /* skip broken card */
//           }
//         }
//         return out;
//       },
//       { CARD_SELECTOR, MAX_DESC, debug },
//     );

//     results = raw.map((r) =>
//       buildJobObject({
//         title: r.title,
//         location: r.location || "Uganda",
//         industry_sector: r.sector,
//         type: r.type,
//         amount: r.amount,
//         time_added: toIso(r.posted),
//         description: r.desc,
//         url_link: r.href,
//       }),
//     );
//   } catch (err) {
//     console.error("[fuzu_uganda] scrape failed:", err.message);
//   } finally {
//     await browser.close();
//   }

//   return results;
// }

// module.exports = { scrape };

// if (require.main === module) {
//   scrape().then((data) => {
//     console.log(JSON.stringify(data, null, 2));
//     console.log(`\nTotal jobs scraped: ${data.length}`);
//   });
// }
/**
 * 1_fuzu_uganda.js  (v5 — paginated + diagnostics)
 * Fuzu Uganda jobs — https://www.fuzu.com/uganda/job
 */

const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const BASE_URL = "https://www.fuzu.com/uganda/job";
const CARD_SELECTOR = "div.b2c-card";
const MAX_DESC = 400;
const MIN_PAGE_DELAY_MS = 3000;
const MAX_PAGE_DELAY_MS = 6000;
const MAX_PAGES_HARD_CAP = 50;

function toIso(text) {
  if (!text) return "";
  const t = String(text)
    .replace(/^posted:?\s*/i, "")
    .trim();
  const d = new Date(t + (/\d{4}-\d{2}-\d{2}T/.test(t) ? "" : " UTC"));
  return isNaN(d) ? t : d.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return (
    MIN_PAGE_DELAY_MS + Math.random() * (MAX_PAGE_DELAY_MS - MIN_PAGE_DELAY_MS)
  );
}

async function detectMaxPage(page) {
  const max = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="page="]')];
    let best = 1;
    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/page=(\d+)/);
      const text = (a.textContent || "").trim();
      const fromHref = m ? parseInt(m[1], 10) : 0;
      const fromText = /^\d+$/.test(text) ? parseInt(text, 10) : 0;
      best = Math.max(best, fromHref, fromText);
    }
    return best;
  });
  return Number.isFinite(max) && max > 0 ? max : 1;
}

async function dumpDiagnostics(page, status, label) {
  console.error(`[fuzu_uganda] diagnostics for ${label}:`);
  console.error(`  HTTP status: ${status}`);
  console.error(`  Final URL: ${page.url()}`);
  const title = await page.title().catch(() => "(error)");
  console.error(`  Page title: ${title}`);
  const bodySnippet = await page
    .evaluate(() => (document.body?.innerText || "").slice(0, 400))
    .catch(() => "(error reading body)");
  console.error(`  Body start: ${bodySnippet.replace(/\n/g, " ")}`);
}

async function extractCards(page, debug) {
  const { jobs, debugInfo } = await page.evaluate(
    ({ CARD_SELECTOR, MAX_DESC, debug }) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const stripBullet = (s) => clean(s).replace(/^[•·\-–—\s]+/, "");
      const stripHtml = (html) => {
        const d = document.createElement("div");
        d.innerHTML = html || "";
        return clean(d.textContent);
      };

      const out = [];
      const seen = new Set();
      let debugInfo = null;

      for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        try {
          const a = card.querySelector("h2 a[href]");
          if (!a) continue;
          const href = a.href;
          if (seen.has(href)) continue;
          seen.add(href);

          const title = clean(a.textContent);
          const lines = (card.innerText || "")
            .split("\n")
            .map(stripBullet)
            .filter((l) => l && l !== title);

          const find = (re, maxLen = 90) =>
            lines.find((l) => re.test(l) && l.length <= maxLen) || "";

          const locRe =
            /district|kampala|remote|wakiso|entebbe|gulu|mbarara|jinja|mukono|lira|arua|mbale|fort portal|buliisa|kyenjojo|ntungamo|ntungamu/i;
          const location = find(locRe) || find(/uganda/i) || "";

          const type = find(
            /full[- ]?time|part[- ]?time|contract|internship|consultan|volunteer|temporary|permanent|fixed[- ]term/i,
            60,
          );
          const amount = find(/ugx|ushs|usd|\$|salary/i, 60);

          const timeEl = card.querySelector("time");
          const posted = timeEl
            ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
            : find(/\bago\b|posted|today|yesterday/i, 40);

          const catLink = card.querySelector('a[href*="/uganda/job/"]');
          let sector = catLink ? stripBullet(catLink.textContent) : "";
          if (sector.toLowerCase() === location.toLowerCase()) sector = "";

          const desc = stripHtml(card.getAttribute("description")).slice(
            0,
            MAX_DESC,
          );

          if (debug && !debugInfo) {
            const clone = card.cloneNode(true);
            clone.removeAttribute("description");
            debugInfo = { lines, html: clone.outerHTML.slice(0, 2500) };
          }

          out.push({
            id: card.id,
            title,
            href,
            location,
            type,
            amount,
            posted,
            sector,
            desc,
          });
        } catch (e) {
          /* skip broken card */
        }
      }
      return { jobs: out, debugInfo };
    },
    { CARD_SELECTOR, MAX_DESC, debug },
  );

  if (debug && debugInfo) {
    console.error(
      "[DEBUG_FUZU] text lines:",
      JSON.stringify(debugInfo.lines, null, 2),
    );
    console.error("[DEBUG_FUZU] html:\n", debugInfo.html);
  }

  return jobs;
}

async function loadPage(page, url, label) {
  const response = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 45000,
  });
  const status = response ? response.status() : null;
  try {
    await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ok: true, status };
  } catch (e) {
    await dumpDiagnostics(page, status, label);
    return { ok: false, status };
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  const allRaw = [];
  const seenUrls = new Set();
  const debug = process.env.DEBUG_FUZU === "1";

  try {
    const page = await context.newPage();
    await blockHeavyResources(page);

    const first = await loadPage(page, BASE_URL, "page 1");
    if (!first.ok) {
      console.error("[fuzu_uganda] page 1 failed to produce cards — aborting.");
      return [];
    }

    const maxPage = Math.min(await detectMaxPage(page), MAX_PAGES_HARD_CAP);
    console.error(`[fuzu_uganda] detected ${maxPage} page(s)`);

    let jobs = await extractCards(page, debug);
    let prevFirstHref = jobs[0]?.href || null;
    for (const j of jobs) {
      if (!seenUrls.has(j.href)) {
        seenUrls.add(j.href);
        allRaw.push(j);
      }
    }

    for (let p = 2; p <= maxPage; p++) {
      const delay = randomDelay();
      console.error(
        `[fuzu_uganda] waiting ${Math.round(delay)}ms before page ${p}`,
      );
      await sleep(delay);

      const url = `${BASE_URL}?page=${p}`;
      const result = await loadPage(page, url, `page ${p}`);
      if (!result.ok) {
        console.error(`[fuzu_uganda] page ${p} produced no cards, stopping.`);
        break;
      }

      jobs = await extractCards(page, false);
      if (jobs.length === 0) {
        console.error(`[fuzu_uganda] page ${p} returned 0 cards, stopping.`);
        break;
      }
      if (jobs[0].href === prevFirstHref) {
        console.error(
          `[fuzu_uganda] page ${p} repeats page ${p - 1}'s first job, stopping.`,
        );
        break;
      }
      prevFirstHref = jobs[0].href;

      let newCount = 0;
      for (const j of jobs) {
        if (!seenUrls.has(j.href)) {
          seenUrls.add(j.href);
          allRaw.push(j);
          newCount++;
        }
      }
      console.error(
        `[fuzu_uganda] page ${p}: status=${result.status} ${jobs.length} cards, ${newCount} new`,
      );
    }
  } catch (err) {
    console.error("[fuzu_uganda] scrape failed:", err.message);
  } finally {
    await browser.close();
  }

  return allRaw.map((r) =>
    buildJobObject({
      title: r.title,
      location: r.location || "Uganda",
      industry_sector: r.sector,
      type: r.type,
      amount: r.amount,
      time_added: toIso(r.posted),
      description: r.desc,
      url_link: r.href,
    }),
  );
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
