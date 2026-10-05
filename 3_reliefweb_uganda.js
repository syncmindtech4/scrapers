/**
 * 3_reliefweb_uganda.js  (v3)
 * ReliefWeb jobs filtered to Uganda (advanced-search=(C240)).
 *
 * v3 changes:
 *  - Card location = country tags only. ReliefWeb tag links carry a code in
 *    advanced-search=(C###) for countries and (S###) for sources/organizations,
 *    so organizations no longer leak into `location`. The organization is
 *    prefixed onto `description` instead (schema has no employer field).
 *  - Sector / type / description are NOT on the list cards, so each job's
 *    detail page is visited (3 at a time, with a small delay) to fill them.
 *  - Set DEBUG_RW=1 to print the tag-code groups found on the first detail
 *    page, which tells us exactly how to map fields if any stay "Not Specified".
 */

const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const TARGET_URL = "https://reliefweb.int/jobs?advanced-search=%28C240%29";
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 700;
const MAX_DESC = 400;

// Tag-code prefix -> field. C and S are confirmed by your output; the others
// are best guesses and are backed up by label matching + DEBUG_RW output.
const CODE_FIELD = { CC: "sector", T: "sector", TY: "type", EX: "experience" };

async function scrapeList(page) {
  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForSelector('a[href*="/job/"]', { timeout: 20000 });

  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const codeOf = (a) => {
      const m = decodeURIComponent(a.getAttribute("href") || "").match(
        /advanced-search=\(([A-Z]+)(\d+)\)/,
      );
      return m ? m[1] : "";
    };
    const out = [];
    const seen = new Set();

    for (const a of document.querySelectorAll("a[href]")) {
      try {
        if (!/\/job\/\d+/.test(a.getAttribute("href") || "")) continue;
        const href = a.href;
        const title = clean(a.textContent);
        if (!title || seen.has(href)) continue;
        const container =
          a.closest("article") || a.closest("li") || a.parentElement;
        if (!container) continue;
        seen.add(href);

        const tags = Array.from(
          container.querySelectorAll('a[href*="advanced-search"]'),
        ).map((x) => ({
          code: codeOf(x),
          text: clean(x.textContent),
        }));
        const countries = tags.filter((t) => t.code === "C").map((t) => t.text);
        const orgs = tags.filter((t) => t.code === "S").map((t) => t.text);

        const timeEl = container.querySelector("time");
        out.push({
          title,
          href,
          countries,
          orgs,
          time_added: timeEl
            ? timeEl.getAttribute("datetime") || clean(timeEl.textContent)
            : "",
        });
      } catch (e) {
        /* skip broken card */
      }
    }
    return out;
  });
}

async function scrapeDetail(context, url, debug) {
  const page = await context.newPage();
  try {
    await blockHeavyResources(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForSelector("h1", { timeout: 15000 }).catch(() => {});

    return await page.evaluate(
      ({ CODE_FIELD, MAX_DESC, debug }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const res = { sector: [], type: [], experience: [], desc: "" };
        const groups = {};

        for (const a of document.querySelectorAll(
          'a[href*="advanced-search"]',
        )) {
          const m = decodeURIComponent(a.getAttribute("href") || "").match(
            /advanced-search=\(([A-Z]+)(\d+)\)/,
          );
          if (!m) continue;
          const text = clean(a.textContent);
          if (!text) continue;
          (groups[m[1]] = groups[m[1]] || []).push(text);
          const field = CODE_FIELD[m[1]];
          if (field) res[field].push(text);
        }

        // Label-based fallback: "Job type", "Career categories", etc.
        const labelGrab = (re) => {
          for (const n of document.querySelectorAll(
            'dt, th, h3, h4, strong, label, [class*="label"]',
          )) {
            const t = clean(n.textContent);
            if (t.length < 40 && re.test(t)) {
              const sib = n.nextElementSibling;
              if (sib) return clean(sib.textContent);
            }
          }
          return "";
        };
        if (!res.type.length) {
          const v = labelGrab(/job type|contract|employment/i);
          if (v) res.type.push(v);
        }
        if (!res.sector.length) {
          const v = labelGrab(/career categor|theme|sector/i);
          if (v) res.sector.push(v);
        }

        const og = document.querySelector(
          'meta[property="og:description"], meta[name="description"]',
        );
        let desc = og ? clean(og.getAttribute("content")) : "";
        if (!desc) {
          const p = Array.from(document.querySelectorAll("main p, article p"))
            .map((x) => clean(x.textContent))
            .find((t) => t.length > 60);
          desc = p || "";
        }
        res.desc = desc.slice(0, MAX_DESC);
        if (debug) res.groups = groups;
        return res;
      },
      { CODE_FIELD, MAX_DESC, debug },
    );
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const { browser, context } = await launchBrowser();
  let results = [];

  try {
    const listPage = await context.newPage();
    await blockHeavyResources(listPage);
    const cards = await scrapeList(listPage);
    await listPage.close();

    const details = new Array(cards.length).fill(null);
    let next = 0;
    let debugPrinted = false;

    async function worker() {
      while (next < cards.length) {
        const i = next++;
        const wantDebug = process.env.DEBUG_RW === "1" && !debugPrinted;
        if (wantDebug) debugPrinted = true;
        details[i] = await scrapeDetail(context, cards[i].href, wantDebug);
        if (wantDebug && details[i] && details[i].groups) {
          console.log("[DEBUG_RW] tag-code groups on", cards[i].href);
          console.log(JSON.stringify(details[i].groups, null, 2));
        }
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
      }
    }
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));

    results = cards.map((c, i) => {
      const d = details[i] || { sector: [], type: [], desc: "" };
      const org = c.orgs.length ? `Organization: ${c.orgs.join(", ")}. ` : "";
      return buildJobObject({
        title: c.title,
        location: c.countries.length ? c.countries.join(", ") : "Uganda",
        industry_sector: d.sector.join(", "),
        type: d.type.join(", "),
        amount: "Not Disclosed",
        time_added: c.time_added,
        description: (org + (d.desc || "")).trim(),
        url_link: c.href,
      });
    });
  } catch (err) {
    console.error("[reliefweb_uganda] scrape failed:", err.message);
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
