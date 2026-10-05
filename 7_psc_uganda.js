/**
 * 7_psc_uganda.js
 * Scraper for Public Service Commission Uganda vacancies (ASP.NET table).
 * https://vacancies.psc.go.ug/
 *
 * NOTE: ASP.NET WebForms sites often use __doPostBack for pagination and
 * ViewState-driven table rendering. This scraper targets the initial
 * vacancy table on page load. If the site paginates via postback, you'll
 * need to click the pager control and re-scrape after each navigation
 * (a loop calling page.click on the pager + waitForLoadState is provided
 * as a commented extension point below).
 */

const {
  launchBrowser,
  blockHeavyResources,
  safeExtract,
  resolveUrl,
  buildJobObject,
} = require('./_utils');

const TARGET_URL = 'https://vacancies.psc.go.ug/';
const TABLE_SELECTOR = 'table.vacancies, table[id*="Vacanc"], table.table';
const ROW_SELECTOR = `${TABLE_SELECTOR} tbody tr`;

async function scrape() {
  const { browser, context } = await launchBrowser();
  const results = [];

  try {
    const page = await context.newPage();
    await blockHeavyResources(page);

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 45000 });

    try {
      await page.waitForSelector(TABLE_SELECTOR, { timeout: 20000 });
    } catch (err) {
      // Table may render under a different id/class; try any table with rows.
      await page.waitForSelector('table tr', { timeout: 15000 }).catch(() => {});
    }

    const rows = await page.$$(ROW_SELECTOR.length ? ROW_SELECTOR : 'table tr');

    for (const row of rows) {
      try {
        // Skip header rows with no <td> cells
        const cellCount = await row.$$eval('td', (tds) => tds.length).catch(() => 0);
        if (cellCount === 0) continue;

        const title = await safeExtract(async () => {
          const el = await row.$('td:nth-child(1) a, td:nth-child(1)');
          return el ? el.innerText() : null;
        });

        const industry_sector = await safeExtract(async () => {
          const el = await row.$('td:nth-child(2)');
          return el ? el.innerText() : null;
        }, 'Government / Public Service');

        const location = await safeExtract(async () => {
          const el = await row.$('td:nth-child(3)');
          return el ? el.innerText() : null;
        }, 'Kampala, Uganda');

        const type = await safeExtract(async () => {
          const el = await row.$('td:nth-child(4)');
          return el ? el.innerText() : null;
        }, 'Government Scale');

        const amount = await safeExtract(async () => {
          const el = await row.$('td:nth-child(5)');
          return el ? el.innerText() : null;
        });

        const time_added = await safeExtract(async () => {
          const el = await row.$('td:nth-child(6), td:last-child');
          return el ? el.innerText() : null;
        }, new Date().toISOString());

        const description = await safeExtract(async () => {
          const el = await row.$('td:nth-child(1)');
          return el ? `Vacancy details: ${await el.innerText()}` : null;
        });

        const url_link = await safeExtract(async () => {
          const el = await row.$('a');
          if (!el) return null;
          const href = await el.getAttribute('href');
          return resolveUrl(TARGET_URL, href);
        }, TARGET_URL);

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

    // --- Pagination extension point (ASP.NET postback pager) ---
    // If the vacancies table paginates via __doPostBack, uncomment and
    // adapt the loop below to click through pages, re-selecting rows
    // after each postback completes:
    //
    // let hasNextPage = true;
    // while (hasNextPage) {
    //   const nextBtn = await page.$('a[id*="Next"], input[value="Next"]');
    //   if (!nextBtn) { hasNextPage = false; break; }
    //   await Promise.all([
    //     page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    //     nextBtn.click(),
    //   ]);
    //   const nextRows = await page.$$(ROW_SELECTOR);
    //   // ... repeat extraction loop for nextRows, push into results ...
    // }
  } catch (err) {
    console.error('[psc_uganda] scrape failed:', err.message);
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
