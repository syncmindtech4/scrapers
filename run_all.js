/**
 * run_all.js
 * Runs all 8 scrapers (in parallel-limited batches) and writes a merged
 * JSON file of all jobs to ./output/jobs.json, plus a per-source summary.
 *
 * Usage: node run_all.js
 */

const fs = require('fs');
const path = require('path');

const scrapers = [
  { name: 'Fuzu Uganda', mod: require('./1_fuzu_uganda') },
  { name: 'BrighterMonday Uganda', mod: require('./2_brightermonday_uganda') },
  { name: 'ReliefWeb Uganda', mod: require('./3_reliefweb_uganda') },
  { name: 'Q-Sourcing Servtec', mod: require('./4_qsourcing_servtec') },
  { name: 'Jiji Uganda Jobs', mod: require('./5_jiji_uganda_jobs') },
  { name: 'Great Uganda Jobs', mod: require('./6_great_uganda_jobs') },
  { name: 'PSC Uganda', mod: require('./7_psc_uganda') },
  { name: 'ImpactPool Uganda', mod: require('./8_impactpool_uganda') },
];

// Run scrapers with limited concurrency to avoid overloading the machine
// (each one launches its own headless Chromium instance).
const CONCURRENCY = 3;

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      results[currentIndex] = await worker(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Starting scrape of ${scrapers.length} sources (concurrency: ${CONCURRENCY})...\n`);

  const startTime = Date.now();

  const outcomes = await runWithConcurrency(scrapers, CONCURRENCY, async (source) => {
    const sourceStart = Date.now();
    try {
      const jobs = await source.mod.scrape();
      const durationSec = ((Date.now() - sourceStart) / 1000).toFixed(1);
      console.log(`✔ ${source.name}: ${jobs.length} jobs (${durationSec}s)`);
      return { source: source.name, jobs, error: null };
    } catch (err) {
      const durationSec = ((Date.now() - sourceStart) / 1000).toFixed(1);
      console.error(`✘ ${source.name}: failed after ${durationSec}s — ${err.message}`);
      return { source: source.name, jobs: [], error: err.message };
    }
  });

  const allJobs = outcomes.flatMap((o) => o.jobs);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jobsFile = path.join(outputDir, 'jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify(allJobs, null, 2), 'utf-8');

  const summaryFile = path.join(outputDir, 'summary.json');
  fs.writeFileSync(
    summaryFile,
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        total_jobs: allJobs.length,
        sources: outcomes.map((o) => ({
          source: o.source,
          job_count: o.jobs.length,
          error: o.error,
        })),
      },
      null,
      2
    ),
    'utf-8'
  );

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${totalSec}s. Total jobs: ${allJobs.length}`);
  console.log(`Merged output: ${jobsFile}`);
  console.log(`Summary: ${summaryFile}`);
}

main().catch((err) => {
  console.error('Fatal error running scrapers:', err);
  process.exit(1);
});
