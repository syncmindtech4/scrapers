/**
 * run_all.js (v2)
 * Master pipeline: runs all scrapers in /scrapers, saves output/jobs.json +
 * output/summary.json (as before), AND publishes every batch to the
 * Supabase ingest-jobs Edge Function.
 *
 * Usage:
 *   node run_all.js                 full pipeline (scrape + save + publish)
 *   node run_all.js --no-push       scrape + save only (don't touch the DB)
 *   node run_all.js --only=fuzu     run a single source end-to-end
 */
const fs = require("fs");
const path = require("path");

// ----- Supabase config: env vars first, then local secrets.json -----
let fileSecrets = {};
try {
  fileSecrets = require("./secrets.json");
} catch {}

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  fileSecrets.SUPABASE_URL ||
  "https://xjpzyspvkavxszebcalw.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || fileSecrets.SUPABASE_ANON_KEY || "";
const INGEST_SECRET =
  process.env.INGEST_SECRET || fileSecrets.INGEST_SECRET || "";

if (!SUPABASE_ANON_KEY || !INGEST_SECRET) {
  console.error(
    "❌ Missing SUPABASE_ANON_KEY / INGEST_SECRET (env vars or secrets.json).",
  );
  process.exit(1);
}
const CHUNK_SIZE = 50;
const CONCURRENCY = 2; // Playwright is heavy; 2 browsers at a time is safe

// ----- CLI flags -----
const args = process.argv.slice(2);
const NO_PUSH = args.includes("--no-push");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg
  ? onlyArg
      .split("=")[1]
      .split(",")
      .map((s) => s.trim())
  : null;

// ----- Sources (ids match the `source` column in your jobs table) -----
const SOURCES = [
  { id: "fuzu", file: "./scrapers/fuzu_uganda" },
  { id: "brightermonday", file: "./scrapers/brightermonday_uganda" },
  { id: "reliefweb", file: "./scrapers/reliefweb_uganda" },
  { id: "qsourcing", file: "./scrapers/qsourcing_servtec" },
  { id: "greatugandajobs", file: "./scrapers/great_uganda_jobs" },
];

const log = (msg) => console.log(msg);

// ----- Publish one source's jobs in chunks -----
async function pushSource(sourceId, jobs) {
  const report = { inserted: 0, updated: 0, rejected: 0, errors: [] };
  if (!jobs.length) return report;

  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(INGEST_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "x-ingest-secret": INGEST_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: sourceId, jobs: chunk }),
      });
      const result = await res.json();
      if (!res.ok) {
        report.errors.push({ chunk: i / CHUNK_SIZE + 1, error: result });
        continue;
      }
      report.inserted += result.inserted || 0;
      report.updated += result.updated || 0;
      report.rejected += result.rejected || 0;
      if (result.errors && result.errors.length)
        report.errors.push(...result.errors);
    } catch (err) {
      report.errors.push({ chunk: i / CHUNK_SIZE + 1, error: err.message });
    }
  }
  return report;
}

// ----- Run a single scraper safely -----
async function runScraper(source) {
  const started = Date.now();
  log(`⏳ [${source.id}] scraping...`);
  try {
    const mod = require(source.file);
    const jobs = await mod.scrape();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (!jobs || jobs.length === 0) {
      log(
        `⚠️  [${source.id}] returned 0 jobs (${secs}s) — check for layout change or bot block!`,
      );
      return { id: source.id, jobs: [], durationSec: Number(secs), push: null };
    }
    log(`✔ [${source.id}] ${jobs.length} jobs (${secs}s)`);
    return { id: source.id, jobs, durationSec: Number(secs), push: null };
  } catch (err) {
    log(`❌ [${source.id}] crashed: ${err.message}`);
    return {
      id: source.id,
      jobs: [],
      durationSec: 0,
      error: err.message,
      push: null,
    };
  }
}

// ----- Tiny concurrency pool -----
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

async function main() {
  log("=================================================");
  log("  JOB PIPELINE — scrape → save → publish");
  log("=================================================");
  const started = Date.now();

  const active = ONLY ? SOURCES.filter((s) => ONLY.includes(s.id)) : SOURCES;
  const results = await pool(
    active.map((s) => () => runScraper(s)),
    CONCURRENCY,
  );

  // Publish to Supabase
  if (!NO_PUSH) {
    for (const r of results) {
      if (!r.jobs.length) continue;
      log(`🚀 [${r.id}] publishing ${r.jobs.length} jobs...`);
      r.push = await pushSource(r.id, r.jobs);
      log(
        `✅ [${r.id}] inserted=${r.push.inserted} updated=${r.push.updated} rejected=${r.push.rejected}`,
      );
      if (r.push.errors.length)
        log(`   ⚠️ push errors: ${JSON.stringify(r.push.errors.slice(0, 3))}`);
    }
  } else {
    log("\n⏭️  --no-push flag set: skipping Supabase publish.");
  }

  // Save local artifacts (same as before)
  const allJobs = results.flatMap((r) => r.jobs);
  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "jobs.json"),
    JSON.stringify(allJobs, null, 2),
  );

  const summary = {
    ranAt: new Date().toISOString(),
    durationSec: Number(((Date.now() - started) / 1000).toFixed(1)),
    pushed: !NO_PUSH,
    totals: {
      jobs: allJobs.length,
      inserted: results.reduce((n, r) => n + (r.push?.inserted || 0), 0),
      updated: results.reduce((n, r) => n + (r.push?.updated || 0), 0),
      rejected: results.reduce((n, r) => n + (r.push?.rejected || 0), 0),
    },
    sources: results.map((r) => ({
      source: r.id,
      jobs: r.jobs.length,
      durationSec: r.durationSec,
      error: r.error || null,
      push: r.push,
    })),
  };
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  log(
    `\n📁 Saved output/jobs.json (${allJobs.length} jobs) + output/summary.json`,
  );

  log("\n=================================================");
  log(`🏁 PIPELINE COMPLETE in ${summary.durationSec}s`);
  log("=================================================");
  // NOTE: no process.exit() here. On Windows, exiting immediately races with
  // Playwright's handle cleanup and triggers a libuv assertion crash.
}

main()
  .catch((err) => {
    console.error("Pipeline fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // If Playwright left lingering handles, the event loop won't drain on its
    // own. This unref'd watchdog force-exits after 5s — but it never interferes
    // with a clean shutdown, because unref'd timers don't keep the loop alive.
    setTimeout(() => process.exit(process.exitCode || 0), 5000).unref();
  });
