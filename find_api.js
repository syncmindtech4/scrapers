/**
 * find_api.js
 * Intercepts background network requests to find the hidden JSON API for jobs.co.ug
 */
const { launchBrowser } = require("./_utils");

async function findApi() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  const apiResponses = [];

  // Listen to ALL network traffic
  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";

    // We only care about JSON or API calls
    if (
      contentType.includes("application/json") ||
      url.includes("/api/") ||
      url.includes("graphql") ||
      url.includes("__nuxt")
    ) {
      try {
        const text = await response.text();
        // Check if the payload looks like job data
        if (
          text.includes("MARKETING") ||
          text.includes("title") ||
          text.includes("company") ||
          text.includes("job")
        ) {
          apiResponses.push({
            url: url,
            snippet: text.substring(0, 300), // First 300 chars of the JSON
          });
        }
      } catch (e) {
        // Ignore non-JSON responses
      }
    }
  });

  console.log("Navigating to jobs.co.ug and listening to network traffic...");
  await page.goto("https://jobs.co.ug/", {
    waitUntil: "networkidle",
    timeout: 45000,
  });
  await page.waitForTimeout(3000);

  console.log("\n--- 🕵️ HIDDEN API ENDPOINTS FOUND ---");
  if (apiResponses.length === 0) {
    console.log(
      "No obvious JSON APIs found. The site might be rendering purely from HTML or using WebSockets.",
    );
  } else {
    console.log(JSON.stringify(apiResponses, null, 2));
  }

  await browser.close();
}

findApi();
