const { scrapeGeneric } = require("./generic_engine");

const COUNTRIES = {
  Uganda: "jobs-in-uganda",
  Kenya: "jobs-in-kenya",
  Tanzania: "jobs-in-tanzania",
  Rwanda: "jobs-in-rwanda",
  Ethiopia: "jobs-in-ethiopia",
  Ghana: "jobs-in-ghana",
  "South Sudan": "jobs-in-south-sudan",
};

async function scrape() {
  const all = [];
  for (const [country, slug] of Object.entries(COUNTRIES)) {
    try {
      const jobs = await scrapeGeneric({
        sourceId: "africareers",
        listUrl: `https://www.africareers.net/country/${slug}`,
        maxPages: 2,
        country,
      });
      all.push(...jobs);
    } catch (e) {
      console.error(`[africareers:${country}] failed:`, e.message);
    }
  }
  return all;
}

module.exports = { scrape };
