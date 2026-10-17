const {
  launchBrowser,
  blockHeavyResources,
  buildJobObject,
} = require("./_utils");

const LIST_URL = "https://vacancies.psc.go.ug/";
const MAX_DESC = 400;

async function scrape() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);
  let results = [];

  try {
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForSelector("table", { timeout: 20000 }).catch(async () => {
      console.error(
        "[psc_uganda] No table found. Page title:",
        await page.title(),
      );
      console.error(
        "[psc_uganda] Body snippet:",
        await page.evaluate(() => document.body.innerText.slice(0, 500)),
      );
      return [];
    });

    results = await page.evaluate(
      ({ MAX_DESC }) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const out = [];
        const tables = Array.from(document.querySelectorAll("table"));
        const targetTable = tables.reduce(
          (prev, current) =>
            prev.rows.length > current.rows.length ? prev : current,
          tables[0],
        );
        if (!targetTable) return out;

        const rows = targetTable.querySelectorAll("tbody tr, tr");
        const headerCells = targetTable.querySelectorAll(
          "thead th, tr:first-child th",
        );
        const headers = Array.from(headerCells).map((th) =>
          clean(th.textContent).toLowerCase(),
        );

        const colIndex = (keywords) => {
          for (const kw of keywords) {
            const idx = headers.findIndex((h) => h.includes(kw));
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const iT = colIndex(["title", "vacancy", "position", "job"]);
        const iS = colIndex(["ministry", "department", "sector", "mda"]);
        const iL = colIndex(["location", "district", "duty station"]);
        const iTy = colIndex(["type", "scale", "contract"]);
        const iA = colIndex(["salary", "pay", "scale"]);
        const iD = colIndex(["date", "posted", "closing"]);

        for (const row of rows) {
          try {
            if (row.querySelector("th")) continue;
            const cells = row.querySelectorAll("td");
            if (cells.length < 2) continue;
            const a = row.querySelector("a[href]");
            if (!a) continue;

            const cellText = (idx) =>
              idx >= 0 && cells[idx] ? clean(cells[idx].textContent) : "";
            const title = iT >= 0 ? cellText(iT) : clean(a.textContent);
            if (!title) continue;

            out.push({
              title,
              href: a.href,
              industry_sector: cellText(iS) || "Public Service",
              location: cellText(iL) || "Uganda",
              type: cellText(iTy) || "Not Specified",
              amount: cellText(iA) || "Not Disclosed",
              time_added: cellText(iD)
                ? new Date(cellText(iD)).toISOString()
                : new Date().toISOString(),
              description: "Not Specified",
            });
          } catch (e) {
            /* skip */
          }
        }
        return out;
      },
      { MAX_DESC },
    );
  } catch (err) {
    console.error("[psc_uganda] scrape failed:", err.message);
  } finally {
    await browser.close();
  }

  return results.map((r) =>
    buildJobObject({ ...r, employer: "Public Service Commission" }),
  );
}

module.exports = { scrape };
if (require.main === module) {
  scrape().then((data) => {
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
    console.log(`\nTotal jobs scraped: ${data.length}`);
  });
}
