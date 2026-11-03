/**
 * debug_jobs_co_ug_v2.js
 * Advanced debugger for Vue/Nuxt SPAs.
 * Finds elements by their exact text content, then walks up the DOM to find the card wrapper.
 */
const { launchBrowser, blockHeavyResources } = require("./_utils");

async function debug() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  console.log("Navigating to jobs.co.ug...");
  await page.goto("https://jobs.co.ug/", {
    waitUntil: "networkidle",
    timeout: 45000,
  });

  // Vue/Nuxt apps need extra time to hydrate the DOM after networkidle
  console.log("Waiting 5 seconds for Vue hydration...");
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    // Helper to walk up the DOM and find a reasonable card container
    function findCardWrapper(el) {
      let current = el;
      for (let i = 0; i < 8; i++) {
        if (!current.parentElement) break;
        current = current.parentElement;
        // Heuristic: A card wrapper usually has a class with 'card', 'item', 'job', 'list', 'grid', or is an <article>/<li>
        if (
          current.className &&
          typeof current.className === "string" &&
          /card|item|job|list|grid|row/i.test(current.className)
        ) {
          return current;
        }
        if (current.tagName === "ARTICLE" || current.tagName === "LI") {
          return current;
        }
      }
      return el; // fallback
    }

    const results = [];
    // We know these exact strings are on the page from the previous text dump
    const targetTexts = [
      "MARKETING OFFICER",
      "Regional Coordinators",
      "Wagagai Mining",
    ];

    for (const text of targetTexts) {
      // Use XPath to find the exact element containing this text
      const xpath = `//*/text()[contains(., '${text}')]/..`;
      const snapshot = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );

      if (snapshot.snapshotLength > 0) {
        const el = snapshot.snapshotItem(0);
        const wrapper = findCardWrapper(el);

        // Find the closest link inside or wrapping this card
        const link = wrapper.querySelector("a") || wrapper.closest("a");

        results.push({
          targetText: text,
          cardTag: wrapper.tagName,
          cardClass: wrapper.className,
          cardHTML: wrapper.outerHTML.substring(0, 1500), // First 1500 chars of the card
          linkHref: link
            ? link.getAttribute("href")
            : "No link found in wrapper",
          linkText: link ? link.innerText.substring(0, 50) : "No link",
        });
      }
    }

    // Also dump the pagination structure if we can find "Page 1 of 5"
    const pageText = document.evaluate(
      `//*/text()[contains(., 'Page 1 of')]/..`,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    let paginationHTML = pageText
      ? pageText.parentElement.outerHTML.substring(0, 1000)
      : "Pagination not found";

    return { results, paginationHTML };
  });

  console.log("\n--- EXTRACTED CARD WRAPPERS ---");
  console.log(JSON.stringify(data.results, null, 2));

  console.log("\n--- PAGINATION HTML ---");
  console.log(data.paginationHTML);

  await browser.close();
}

debug();
