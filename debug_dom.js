/**
 * debug_dom.js
 * Finds the real job-card selectors for a site so scrapers can be fixed.
 *
 * Usage:  node debug_dom.js <url> [waitMs]
 * e.g.    node debug_dom.js https://www.fuzu.com/uganda/job 6000
 *
 * Prints: page title, final URL, challenge detection, and the most-repeated
 * "card-like" element signatures with a sample of their HTML.
 * Also saves debug_<host>.html and debug_<host>.png next to this file.
 * Paste the console output back to get exact selectors.
 */
const fs = require('fs');
const { chromium } = require('playwright');
const { USER_AGENT } = require('./_utils');

(async () => {
  const url = process.argv[2];
  const waitMs = parseInt(process.argv[3] || '6000', 10);
  if (!url) {
    console.error('Usage: node debug_dom.js <url> [waitMs]');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(waitMs);
    // nudge lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const host = new URL(url).hostname.replace(/[^a-z0-9]/gi, '_');
    fs.writeFileSync(`debug_${host}.html`, await page.content());
    await page.screenshot({ path: `debug_${host}.png`, fullPage: false });

    const info = await page.evaluate(() => {
      const sigOf = (el) =>
        el.tagName.toLowerCase() +
        (el.classList.length ? '.' + Array.from(el.classList).sort().join('.') : '');
      const groups = new Map();
      for (const el of document.body.querySelectorAll('*')) {
        if (!el.querySelector('a[href]')) continue;
        const len = (el.innerText || '').trim().length;
        if (len < 30 || len > 1500) continue;
        const s = sigOf(el);
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(el);
      }
      const top = Array.from(groups.entries())
        .filter(([, els]) => els.length >= 5)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 6)
        .map(([sig, els]) => ({
          selector: sig,
          count: els.length,
          sample: els[0].outerHTML.replace(/\s+/g, ' ').slice(0, 900),
        }));
      return {
        title: document.title,
        bodyStart: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
        anchors: document.querySelectorAll('a[href]').length,
        top,
      };
    });

    console.log('HTTP status :', resp && resp.status());
    console.log('Final URL   :', page.url());
    console.log('Title       :', info.title);
    console.log('Body start  :', info.bodyStart);
    console.log('Anchors     :', info.anchors);
    if (/just a moment|checking your browser|attention required|verify you are human/i.test(info.title + info.bodyStart)) {
      console.log('\n!! Looks like an anti-bot challenge page. Selectors will not help until that is solved.');
    }
    console.log('\n=== Repeated card-like candidates ===');
    info.top.forEach((t, i) => {
      console.log(`\n#${i + 1}  ${t.selector}   (x${t.count})`);
      console.log(t.sample);
    });
    console.log(`\nSaved debug_${host}.html and debug_${host}.png`);
  } catch (e) {
    console.error('Debug failed:', e.message);
  } finally {
    await browser.close();
  }
})();
