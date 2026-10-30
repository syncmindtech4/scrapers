/**
 * debug_jobadverts.js
 * Dumps the HTML structure of https://jobadverts.ug/jobs/ to help find selectors.
 */
const { launchBrowser, blockHeavyResources } = require("./_utils"); // Adjust path if needed

async function debug() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    await blockHeavyResources(page);
    console.log("Navigating to https://jobadverts.ug/jobs/ ...");

    // Use networkidle to ensure all JS has rendered the list
    await page.goto("https://jobadverts.ug/jobs/", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait a bit extra for lazy loading
    await page.waitForTimeout(2000);

    // 1. Check if we are blocked by Cloudflare/WAF
    const title = await page.title();
    const bodyText = await page.evaluate(() =>
      document.body.innerText.slice(0, 500),
    );

    if (/cloudflare|just a moment|access denied/i.test(bodyText)) {
      console.error("❌ BLOCKED BY CLOUDFLARE OR WAF!");
      console.error("Body snippet:", bodyText);
      return;
    }

    // 2. Dump ALL links that look like job details
    const potentialJobs = await page.evaluate(() => {
      // Heuristic: Look for links containing '/job/' or '/listing/' or '/vacancy/'
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const jobLinks = anchors
        .filter((a) =>
          /\/(job|listing|vacancy|position)s?\/\d+|\/jobs?\/[a-z0-9\-]+$/i.test(
            a.href,
          ),
        )
        .slice(0, 5); // Take first 5 examples

      return jobLinks.map((link) => {
        // Find the closest container that looks like a card
        let card = link.closest("div, li, article, section");
        // Walk up until we find a reasonable parent (max 3 levels)
        for (let i = 0; i < 3 && card.parentElement; i++) {
          if (
            card.className.includes("item") ||
            card.className.includes("card") ||
            card.tagName === "LI" ||
            card.tagName === "ARTICLE"
          )
            break;
          card = card.parentElement;
        }

        return {
          url: link.href,
          text: link.textContent.trim().substring(0, 50),
          cardTag: card.tagName,
          cardClass: card.className,
          cardHTMLSnippet: card.outerHTML.substring(0, 800), // First 800 chars of the card
        };
      });
    });

    if (potentialJobs.length === 0) {
      console.log("⚠️ No obvious job links found via heuristic.");
      console.log("Dumping ALL anchor tags with hrefs containing 'job':");
      const allAnchors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="job"]'))
          .map((a) => ({
            href: a.href,
            text: a.textContent.trim().substring(0, 30),
            parentClass: a.parentElement?.className,
          }))
          .slice(0, 10),
      );
      console.table(allAnchors);
    } else {
      console.log("\n✅ FOUND POTENTIAL JOB CARDS:\n");
      potentialJobs.forEach((j, idx) => {
        console.log(`--- Example ${idx + 1} ---`);
        console.log(`URL: ${j.url}`);
        console.log(`Container Tag: <${j.cardTag}> class="${j.cardClass}"`);
        console.log(`HTML Snippet:\n${j.cardHTMLSnippet}\n`);
      });
    }

    // 3. Also dump the main content area structure to see where the list lives
    const mainStructure = await page.evaluate(() => {
      const main = document.querySelector(
        "main, .content-area, #content, .site-main",
      );
      if (!main) return "No main/content area found.";
      return main.innerHTML.substring(0, 1000);
    });
    console.log("\n--- MAIN CONTENT AREA SNIPPET ---\n", mainStructure);
  } catch (err) {
    console.error("Debug failed:", err.message);
  } finally {
    await browser.close();
  }
}

debug();
