/**
 * cleanup_db.js — Database Hygiene Maintainer
 * Fixes: HTML in descriptions, employer="s", garbage locations, wrong sectors,
 *        future-dated time_added. Deletes non-job pages (blogs/categories/logins).
 * Usage: node cleanup_db.js --dry-run   (preview only, writes nothing)
 *        node cleanup_db.js             (apply all changes)
 */
require("dotenv").config();
const { matchSector } = require("./scrapers/generic_engine");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://xjpzyspvkavxszebcalw.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry-run");
if (!KEY) {
  console.error("❌ Add SUPABASE_SERVICE_ROLE_KEY to .env first.");
  process.exit(1);
}

const H = (extra = {}) => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  ...extra,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- cleaners ---------- */
function stripHtml(s) {
  return (s || "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const CITY_RE =
  /(Kampala|Entebbe|Jinja|Mbarara|Gulu|Mbale|Wakiso|Hoima|Lira|Arua|Fort Portal|Mukono|Masaka|Soroti|Kabale|Busia|Namanve|Kapeeka|Adjumani|Isingiro|Terego|Kasese|Moroto|Nakivale|Kiruhura|Mitooma|Amuria|Masindi|Pallisa|Kyegegwa|Mpigi|Nairobi|Mombasa|Kisumu|Nakuru|Eldoret|Dar es Salaam|Dodoma|Arusha|Mwanza|Mbeya|Tanga|Tema|Kumasi|Accra|Kigali|Addis Ababa|Juba|Multiple locations|Across Uganda|Various|Upcountry|Remote|Uganda|Kenya|Tanzania|Rwanda|Ethiopia|Ghana|South Sudan)/i;
const BAD_LOC_RE =
  /reporting|salary|number of|click|apply|https|role purpose|key responsibilities|purpose and context|managing the|reconciliation of|and risk|vulnerability|travel required|employment type|about |will report|please visit|email|applications|considered on|month on month|selection from|portbell|head office$/i;

function cleanLocation(raw, desc, country) {
  const r = (raw || "").trim();
  if (r && r.length <= 40 && !BAD_LOC_RE.test(r)) {
    const c = r.match(CITY_RE);
    if (c) return c[1];
    if (
      /^[A-Za-z\s,\-&().]+$/.test(r) &&
      r.length <= 25 &&
      r.split(" ").length <= 4
    )
      return r;
  }
  const lm = (desc || "").match(/\bLocation[:\s]+([^\n|,]{3,40})/i);
  if (lm) {
    const c = lm[1].match(CITY_RE);
    if (c) return c[1];
  }
  const dm = (desc || "").match(CITY_RE);
  if (dm) return dm[1];
  return country && country !== "Not Specified" ? country : "Uganda";
}

const BAD_EMP_RE =
  /^s$|^\d+$|posted \d+|weeks? ago|days ago|months? ago|yesterday|size, and experience|the numbers below|email address|read more|show more|click here|view more|^limited$|rest of kenya|vehicle while|services, and driving|seeking to strengthen|that manufactures|wishes to recruit|pilot across|^kaziweza/i;

function cleanEmployer(raw, desc) {
  const r = (raw || "").trim();
  if (r && r !== "Not Specified" && r.length > 2 && !BAD_EMP_RE.test(r))
    return r;
  const d = desc || "";
  let m = d.match(
    /(?:Company|Employer|Organisation|Organization|Hiring Body|Client)[:\s]+([A-Z][A-Za-z0-9\s,&.\-()]{2,60})/,
  );
  if (m) return m[1].trim();
  m = d.match(/Company Description\s+About\s+([A-Z][^\n]{2,60})/);
  if (m) return m[1].trim();
  m = d.match(
    /About\s+([A-Z][A-Za-z0-9\s,&.\-()]{2,50}?)\s+(?:is|was|seeks|invites|looks|operates|provides|has|offers|works)/,
  );
  if (m) return m[1].trim();
  return "Not Specified";
}

function isJunk(row) {
  const u = row.url_link || "",
    t = row.title || "";
  if (
    /\/discover\//.test(u) ||
    /\/account\//.test(u) ||
    /logon|login|PipelinedPage=/i.test(u)
  )
    return true;
  if (
    /^brightermonday/.test(row.source) &&
    !/\/jobs?\/[a-z0-9-]+-\d{4,}\/?$/i.test(u) &&
    !/\/job\/\d+/i.test(u)
  )
    return true;
  if (
    /^(Job Search Advice|Career Development|Complete Profile|How to |Blue-Collar vs|Top \d+ in-demand|Skills vs Degrees|Your CV Should|How to Make)/i.test(
      t,
    )
  )
    return true;
  return false;
}

/* ---------- Supabase REST helpers ---------- */
async function fetchAll() {
  let out = [],
    offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?select=*&limit=1000&offset=${offset}`,
      { headers: H() },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fetch failed: ${res.status} → ${body}`);
    }
    const rows = await res.json();
    out = out.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function pushUpdates(patches) {
  for (let i = 0; i < patches.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
      method: "POST",
      headers: H({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(patches.slice(i, i + 100)),
    });
    if (!res.ok)
      console.error("update chunk failed:", res.status, await res.text());
    await sleep(300);
  }
}

async function pushDeletes(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?id=in.(${ids.slice(i, i + 200).join(",")})`,
      { method: "DELETE", headers: H() },
    );
    if (!res.ok)
      console.error("delete chunk failed:", res.status, await res.text());
    await sleep(300);
  }
}

/* ---------- main ---------- */
(async () => {
  const rows = await fetchAll();
  console.log(`🔍 Scanning ${rows.length} rows...`);
  const now = Date.now();
  const patches = [],
    junkIds = [];
  const stats = {
    html: 0,
    employer: 0,
    location: 0,
    sector: 0,
    date: 0,
    junk: 0,
  };

  for (const r of rows) {
    if (isJunk(r)) {
      junkIds.push(r.id);
      stats.junk++;
      continue;
    }

    const patch = { id: r.id };
    let changed = false;

    const desc = stripHtml(r.description);
    if (desc !== (r.description || "")) {
      patch.description = desc;
      changed = true;
      stats.html++;
    }

    const emp = cleanEmployer(r.employer, desc);
    if (emp !== (r.employer || "").trim()) {
      patch.employer = emp;
      changed = true;
      stats.employer++;
    }

    const loc = cleanLocation(r.location, desc, r.country);
    if (loc !== (r.location || "").trim()) {
      patch.location = loc;
      changed = true;
      stats.location++;
    }

    const sector = matchSector(`${r.title || ""} ${desc}`);
    if (sector !== r.industry_sector) {
      patch.industry_sector = sector;
      changed = true;
      stats.sector++;
    }

    const ta = Date.parse(r.time_added || "");
    if (!isNaN(ta) && ta > now + 60000) {
      patch.time_added =
        r.first_seen_at || r.created_at || new Date(now).toISOString();
      changed = true;
      stats.date++;
    }

    if (changed) patches.push(patch);
  }

  console.log("\n📊 Hygiene report:");
  console.log(`   HTML stripped:        ${stats.html}`);
  console.log(`   Employers fixed:      ${stats.employer}`);
  console.log(`   Locations fixed:      ${stats.location}`);
  console.log(`   Sectors reclassified: ${stats.sector}`);
  console.log(`   Future dates clamped: ${stats.date}`);
  console.log(`   Junk rows to delete:  ${stats.junk}`);

  if (DRY) {
    const bySource = {};
    for (const r of rows)
      if (isJunk(r)) bySource[r.source] = (bySource[r.source] || 0) + 1;
    console.log("\nJunk by source:", bySource);
    console.log("\nSample junk rows:");
    rows
      .filter(isJunk)
      .slice(0, 10)
      .forEach((r) =>
        console.log(`  - [${r.source}] ${r.title} → ${r.url_link}`),
      );
    console.log("\nSample sector reclassifications:");
    let shown = 0;
    for (const r of rows) {
      if (shown >= 10 || isJunk(r)) continue;
      const s = matchSector(`${r.title || ""} ${stripHtml(r.description)}`);
      if (s !== r.industry_sector) {
        console.log(`  - "${r.title}": ${r.industry_sector} → ${s}`);
        shown++;
      }
    }
    console.log("\n🧪 DRY RUN — nothing was written.");
    return;
  }
  await pushUpdates(patches);
  await pushDeletes(junkIds);
  console.log(
    `\n✅ Applied ${patches.length} updates and deleted ${junkIds.length} junk rows.`,
  );
})().catch((e) => {
  console.error("Cleanup failed:", e.message);
  process.exitCode = 1;
});
