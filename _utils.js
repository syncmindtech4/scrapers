/**
 * _utils.js
 * Shared helpers for all job scrapers.
 * CommonJS / Playwright / Node.js
 */

const { chromium } = require("playwright");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
  "font",
  "stylesheet",
]);

// Extra hostnames commonly used for ads/trackers/analytics that we don't need
// for scraping job listings. Extend per-site if needed.
const BLOCKED_URL_FRAGMENTS = [
  "google-analytics",
  "googletagmanager",
  "doubleclick",
  "facebook.net",
  "hotjar",
  "googlesyndication",
  "adservice",
];

/**
 * Launches a headless Chromium browser + context configured with a
 * realistic user agent and viewport.
 */
async function launchBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });

  return { browser, context };
}

/**
 * Attaches a route handler to a page/context that blocks heavy resources
 * (images, fonts, media, stylesheets) and known ad/tracker domains, to
 * speed up scraping.
 */
async function blockHeavyResources(pageOrContext) {
  await pageOrContext.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();

    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      return route.abort();
    }

    if (BLOCKED_URL_FRAGMENTS.some((fragment) => url.includes(fragment))) {
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * Safely runs an extraction function, returning a fallback value
 * ("Not Specified" by default) if it throws or returns empty.
 */
async function safeExtract(fn, fallback = "Not Specified") {
  try {
    const result = await fn();
    if (result === null || result === undefined || result === "") {
      return fallback;
    }
    return typeof result === "string" ? result.trim() : result;
  } catch (err) {
    return fallback;
  }
}

/**
 * Normalizes a relative URL against a base URL. Returns "Not Specified"
 * if construction fails.
 */
function resolveUrl(base, maybeRelative) {
  try {
    if (!maybeRelative) return "Not Specified";
    return new URL(maybeRelative, base).toString();
  } catch (err) {
    return "Not Specified";
  }
}

/**
 * Builds a standardized job object, filling in any missing fields
 * with sensible fallbacks so every scraper returns a uniform shape.
 */
// function buildJobObject({
//   title,
//   location,
//   industry_sector,
//   type,
//   amount,
//   time_added,
//   description,
//   url_link,
// }) {
//   return {
//     title: title || 'Not Specified',
//     location: location || 'Not Specified',
//     industry_sector: industry_sector || 'Not Specified',
//     type: type || 'Not Specified',
//     amount: amount || 'Not Specified',
//     time_added: time_added || new Date().toISOString(),
//     description: description || 'Not Specified',
//     url_link: url_link || 'Not Specified',
//   };
// }

function buildJobObject({
  title,
  location,
  industry_sector,
  type,
  amount,
  time_added,
  description,
  url_link,
  employer,
}) {
  return {
    title: title || "Not Specified",
    location: location || "Not Specified",
    industry_sector: industry_sector || "Not Specified",
    type: type || "Not Specified",
    amount: amount || "Not Disclosed",
    time_added: time_added || new Date().toISOString(),
    description: description || "Not Specified",
    url_link: url_link || "Not Specified",
    employer: employer || "Not Specified",
  };
}

/**
 * Auto-scrolls a page to the bottom repeatedly to trigger lazy/infinite
 * loading of content, up to maxScrolls times or until no new height growth.
 */
async function autoScroll(page, { maxScrolls = 12, pauseMs = 800 } = {}) {
  let previousHeight = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(pauseMs);
  }
}

module.exports = {
  USER_AGENT,
  launchBrowser,
  blockHeavyResources,
  safeExtract,
  resolveUrl,
  buildJobObject,
  autoScroll,
};
