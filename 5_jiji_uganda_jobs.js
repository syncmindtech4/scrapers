const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://jiji.ug/jobs";

function capitalizeWords(str) {
  return str
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Derives a clean title from the URL slug, e.g.
// ".../seeking-for-pump-attendants-kLMsNd6drzA27CeeOgMd2Tmj.html" -> "Seeking For Pump Attendants"
// Jiji appends a long random id as the final hyphen segment before .html; strip it.
function titleFromSlug(href) {
  try {
    const path = new URL(href).pathname;
    const last = (path.split("/").pop() || "").replace(/\.html$/, "");
    const parts = last.split("-");
    if (
      parts.length > 1 &&
      /^[A-Za-z0-9]{15,}$/.test(parts[parts.length - 1])
    ) {
      parts.pop(); // drop the trailing listing id
    }
    return capitalizeWords(parts.join(" "));
  } catch {
    return "";
  }
}

// Derives sector from the URL's "<category>-jobs" path segment, e.g.
// ".../customer-service-jobs/..." -> "Customer Service"
function sectorFromUrl(href) {
  try {
    const segments = new URL(href).pathname.split("/").filter(Boolean);
    const catSeg = segments.find((s) => /-jobs$/.test(s));
    if (!catSeg) return "";
    return capitalizeWords(catSeg.replace(/-jobs$/, ""));
  } catch {
    return "";
  }
}

// Pulls price/type/location out of a card's flattened text. Jiji's markup packs
// these together with no separators, so this leans on known value patterns
// (USh ranges, "Commission", and the fixed set of job-type labels) rather than
// exact class names, which weren't confirmed via a live browser this session.
function parseCardText(text) {
  const priceMatch = text.match(/(USh\s?[\d,]+(?:\s*-\s*[\d,]+)?|Commission)/);
  const typeMatch = text.match(
    /\b(Full-Time|Part-Time|Contract|Freelance|Internship|Temporary)\b/,
  );

  let location = "";
  if (typeMatch) {
    const afterType = text.slice(typeMatch.index + typeMatch[0].length).trim();
    // Strip known trailing seller/listing badges Jiji appends after the location
    location = afterType
      .replace(/\b(enterprise|vip_gold|verified|hot|urgent)\b\s*$/i, "")
      .trim();
  }

  return {
    amount: priceMatch ? priceMatch[0].trim() : "",
    type: typeMatch ? typeMatch[1] : "",
    location,
  };
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

    const pageTitle = await page.title();
    console.error(`[jiji debug] page title: "${pageTitle}"`);

    // If Cloudflare (or similar) challenges headless Chromium, this selector
    // will simply time out and we fall through to the catch below, returning [].
    try {
      await page.waitForSelector('a[href*="-jobs/"][href$=".html"]', {
        timeout: 15000,
      });
    } catch (selectorErr) {
      const bodySnippet = await page.evaluate(() =>
        document.body.innerText.slice(0, 500),
      );
      console.error(
        "[jiji debug] selector never appeared. Body snippet:\n" + bodySnippet,
      );
      throw selectorErr;
    }

    const rawJobs = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll('a[href*="-jobs/"][href$=".html"]'),
      );

      return anchors.map((a) => {
        const text = (a.innerText || "").replace(/\s+/g, " ").trim();
        const href = a.href;

        // Best-effort DOM lookups in case these common class fragments are
        // actually present; harmless no-ops (empty string) if not.
        const titleEl = a.querySelector('[class*="title" i]');
        const titleElText = titleEl
          ? titleEl.textContent.replace(/\s+/g, " ").trim()
          : "";

        return { href, text, titleElText };
      });
    });

    console.error(`[jiji debug] matched ${rawJobs.length} anchors`);

    return rawJobs
      .filter((j) => j.href)
      .map((j) => {
        const parsed = parseCardText(j.text);
        // Prefer a DOM-derived title if it looks sane (short, non-empty);
        // otherwise fall back to the URL-slug-derived title.
        const title =
          j.titleElText && j.titleElText.length < 150
            ? j.titleElText
            : titleFromSlug(j.href);

        return buildJobObject({
          title: title || "Not Specified",
          location: parsed.location || "Not Specified",
          industry_sector: sectorFromUrl(j.href) || "Not Specified",
          type: parsed.type || "Not Specified",
          amount: parsed.amount || "Not Specified",
          time_added: "", // not shown on the listing page; buildJobObject falls back to now()
          description: "", // not reliably isolable from flattened card text without confirmed DOM
          url_link: j.href,
        });
      });
  } catch (err) {
    // Likely a Cloudflare challenge blocking headless Chromium, or a layout
    // change. Fail gracefully rather than crash run_all.js.
    console.error("[jiji debug] scrape failed:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
