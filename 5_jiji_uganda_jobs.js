/**
 * 5_jiji_uganda_jobs.js
 * Scraper for Jiji Uganda job adverts (infinite-scroll marketplace).
 * https://jiji.ug/jobs
 */

const {
  launchBrowser,
  blockHeavyResources,
  safeExtract,
  resolveUrl,
  buildJobObject,
  autoScroll,
} = require('./_utils');

const TARGET_URL = 'https://jiji.ug/jobs';
const CARD_SELECTOR = '.b-list-advert__item, .qa-advert-list-item';

async function scrape() {
  const { browser, context } = await launchBrowser();
  const results = [];

  try {
    const page = await context.newPage();
    await blockHeavyResources(page);

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    try {
      await page.waitForSelector(CARD_SELECTOR, { timeout: 15000 });
    } catch (err) {
      // continue even if initial cards are slow to mount; autoScroll below may trigger load
    }

    // Trigger lazy-loaded cards via scrolling.
    await autoScroll(page, { maxScrolls: 15, pauseMs: 900 });

    const cards = await page.$$(CARD_SELECTOR);

    for (const card of cards) {
      try {
        const title = await safeExtract(async () => {
          const el = await card.$('.b-advert-title-inner, .qa-advert-title, div[class*="title"]');
          return el ? el.innerText() : null;
        });

        const location = await safeExtract(async () => {
          const el = await card.$('.b-list-advert__region__text, span[class*="region"]');
          return el ? el.innerText() : null;
        });

        const industry_sector = await safeExtract(async () => {
          const el = await card.$('.b-list-advert__category, span[class*="category"]');
          return el ? el.innerText() : null;
        });

        const type = await safeExtract(async () => {
          const el = await card.$('.b-list-advert-base__item-attr, span[class*="attribute"]');
          return el ? el.innerText() : null;
        });

        const amount = await safeExtract(async () => {
          const el = await card.$('.qa-advert-price, div[class*="price"]');
          return el ? el.innerText() : null;
        });

        const time_added = await safeExtract(async () => {
          const el = await card.$('.b-list-advert__date, div[class*="date"]');
          return el ? el.innerText() : null;
        }, new Date().toISOString());

        const description = await safeExtract(async () => {
          const el = await card.$('.b-list-advert-base__description, div[class*="description"]');
          return el ? el.innerText() : null;
        });

        const url_link = await safeExtract(async () => {
          const el = await card.$('a');
          if (!el) return null;
          const href = await el.getAttribute('href');
          return resolveUrl(TARGET_URL, href);
        });

        results.push(
          buildJobObject({
            title,
            location,
            industry_sector,
            type,
            amount,
            time_added,
            description,
            url_link,
          })
        );
      } catch (itemErr) {
        continue;
      }
    }
  } catch (err) {
    console.error('[jiji_uganda_jobs] scrape failed:', err.message);
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
