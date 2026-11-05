/**
 * debug_jobs_co_ug.js
 * Dumps the HTML structure of https://jobs.co.ug/ to find the correct selectors.
 */
const { launchBrowser, blockHeavyResources } = require("./_utils");

async function debug() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  await blockHeavyResources(page);

  console.log("Navigating to jobs.co.ug...");
  await page.goto("https://jobs.co.ug/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    // Look for any link that looks like a job detail page
    const links = Array.from(document.querySelectorAll("a"));
    const potentialJobs = links
      .filter((a) => {
        const href = a.href || "";
        const text = a.textContent.trim();
        // Heuristic: long text, deep URL, not a nav link
        return (
          text.length > 20 &&
          text.length < 150 &&
          href.split("/").length >= 4 &&
          !href.includes("login") &&
          !href.includes("register") &&
          !href.includes("#")
        );
      })
      .slice(0, 3); // Just get 3 examples

    return potentialJobs.map((a) => {
      // Walk up the DOM to find the card container
      let card = a.closest("div, li, article, section") || a.parentElement;
      for (let i = 0; i < 3 && card.parentElement; i++) {
        if (
          card.className.includes("job") ||
          card.className.includes("card") ||
          card.tagName === "LI"
        )
          break;
        card = card.parentElement;
      }

      return {
        url: a.href,
        text: a.textContent.trim().substring(0, 60),
        cardTag: card.tagName,
        cardClass: card.className,
        cardHTML: card.outerHTML.substring(0, 600),
      };
    });
  });

  if (data.length === 0) {
    console.log(
      "⚠️ No obvious job links found. Dumping all links with >20 chars:",
    );
    const allLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .filter((a) => a.textContent.trim().length > 20)
        .map((a) => ({
          href: a.href,
          text: a.textContent.trim().substring(0, 50),
        }))
        .slice(0, 10),
    );
    console.table(allLinks);
  } else {
    console.log("\n✅ FOUND JOB CARDS:\n");
    console.log(JSON.stringify(data, null, 2));
  }

  await browser.close();
}

debug();
