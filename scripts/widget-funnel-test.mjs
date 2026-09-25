#!/usr/bin/env node
/**
 * Drives the scheduling widget in a real browser and asserts the funnel events.
 *
 * The widget's step-level analytics exist to answer one question: where do leads stop.
 * That makes the events themselves the deliverable, so they need a test that fails when
 * they regress. There was no test harness in this repo, so this script is self
 * contained: it serves the site, stubs the scheduling API and window.gtag, walks the
 * form, and asserts the exact event sequence.
 *
 * The last case is the important one. Instrumentation sits in the booking path, so the
 * suite proves that a gtag which THROWS on every call still leaves a visitor able to
 * reach the slot grid. If that case ever fails, the analytics must come out.
 *
 *   node scripts/widget-funnel-test.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Per-brand fixtures ──────────────────────────────────────────────────────
// An inline page with booking ON, and a page that opens the widget in a modal.
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'widget-funnel-test.config.json'), 'utf8'));
const { inlinePage, modalPage, city, brand } = CONFIG;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const SLOT = (date, time) => ({ instructor_id: 1, instructor_name: 'Test Teacher', date,
  day: 'Friday', day_of_week: 4, time, lesson_length: 30, cluster_score: 10 });

const AVAIL_FULL = { recommended: SLOT('2026-10-02', '13:45'),
  alternatives: [SLOT('2026-10-02', '14:00'), SLOT('2026-10-09', '13:45')] };
const AVAIL_EMPTY = { recommended: null, alternatives: [] };

let failures = 0;
const results = [];
function check(label, cond, detail = '') {
  results.push({ label, ok: !!cond, detail });
  if (!cond) failures++;
}

/** One scenario must not be able to take the other six down with it.
 *
 * Every waitForSelector and waitForFunction below throws on timeout, and an
 * unguarded throw escaped the whole runner: it skipped the later cases AND the
 * results printout, so the output was a stack trace on exactly the regression this
 * file exists to catch. A scenario that dies now records one failure and the rest
 * still run. */
async function isolate(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} scenario ran to completion`, false, String((e && e.message) || e));
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(0, () => r({ server, port: server.address().port })));
}

/** A page with the API stubbed, third-party analytics blocked, and gtag recording. */
async function newPage(browser, base, route,
                       { availability = AVAIL_FULL, hostileGtag = false, stripRedirect = false,
                         availabilityStatus = 200 } = {}) {
  const page = await browser.newPage();

  // Record through dataLayer rather than by owning window.gtag.
  //
  // Every page here carries the standard snippet `function gtag(){dataLayer.push(
  // arguments)}`. That is a hoisted function DECLARATION, so it replaces any
  // window.gtag installed beforehand and a recorder built that way silently sees
  // nothing. dataLayer survives, because the snippet writes `window.dataLayer =
  // window.dataLayer || []`, and it is also the thing that genuinely reaches Google.
  await page.evaluateOnNewDocument(() => {
    window.__events = [];
    window.dataLayer = window.dataLayer || [];
    const origPush = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function () {
      for (const a of arguments) {
        const arr = Array.from(a || []);
        if (arr[0] === 'event') window.__events.push([arr[1], arr[2] || {}]);
      }
      return origPush.apply(null, arguments);
    };
  });

  await page.setRequestInterception(true);
  page.on('request', req => stubApi(req, availability, stripRedirect, availabilityStatus));

  await page.goto(`${base}${route}`, { waitUntil: 'networkidle2' });
  if (hostileGtag) {
    // Installed after load, so the page's own snippet cannot hoist over it. This is
    // the shape of a real ad blocker: gtag exists and throws.
    await page.evaluate(() => { window.gtag = function () { throw new Error('gtag blocked by an extension'); }; });
  }
  return page;
}

/** The scheduling API, stubbed. CORS headers are not optional: the widget calls a
 *  different origin, so a stub without them is blocked by the browser and the widget
 *  shows its network error instead of a slot grid. POST + JSON preflights, too. */
function stubApi(req, availability, stripRedirect = false, availabilityStatus = 200) {
  const url = req.url();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (/googletagmanager|google-analytics|doubleclick|gstatic|fonts\.googleapis/.test(url)) {
    return req.abort();
  }
  // A successful submit sets window.location to the thank-you page, which destroys the
  // document and window.__events along with it, before the events can be read.
  // Aborting that navigation does not help: Chrome replaces the document with
  // chrome-error://chromewebdata/ and the context is gone either way.
  //
  // So the page is served with its redirect removed instead. The redirect is not what
  // this file tests, and neutering it is the only way to inspect the funnel at the
  // moment of conversion. MCMC_THANK_YOU_REDIRECT is read into a const when the widget
  // script evaluates, so it has to be gone from the HTML rather than unset later.
  if (stripRedirect && req.isNavigationRequest() && !url.includes('/api/')) {
    const file = path.join(ROOT, decodeURIComponent(new URL(url).pathname));
    if (file.startsWith(ROOT) && fs.existsSync(file)) {
      const html = fs.readFileSync(file, 'utf8')
        .replace(/window\.MCMC_THANK_YOU_REDIRECT\s*=\s*'[^']*'/, "window.MCMC_THANK_YOU_REDIRECT = ''");
      return req.respond({ status: 200, contentType: 'text/html', body: html });
    }
  }
  if (!url.includes('/api/scheduling/')) return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
  const json = body => req.respond({ status: 200, headers: cors, contentType: 'application/json',
    body: JSON.stringify(body) });
  if (url.includes('/cities')) return json({ cities: [city, 'Somewhere Else'] });
  if (url.includes('/availability')) {
    if (availabilityStatus !== 200) {
      return req.respond({ status: availabilityStatus, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ detail: 'scheduler unavailable' }) });
    }
    return json(availability);
  }
  return json({ ok: true, id: 1, instructor_name: 'Test Teacher', day: 'Friday', time: '13:45' });
}

const events = page => page.evaluate(() => window.__events);
const evt = (list, name) => list.filter(e => e[0] === name);

async function findSlots(page) {
  await page.waitForSelector('#sw-instrument');
  await page.select('#sw-instrument', 'Guitar');
  // The city is pre-filled from the page, but select it anyway so the test does not
  // depend on the pre-fill surviving the /cities reconcile.
  if (await page.$('#sw-city')) {
    const has = await page.$$eval('#sw-city option', (o, c) => o.some(x => x.value === c), city);
    if (has) await page.select('#sw-city', city);
  }
  await page.click('#sw-find');
}

(async () => {
  const { server, port } = await serve();
  const base = `http://localhost:${port}`;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  try {
    // ── 1. Slots exist: the full happy funnel ───────────────────────────────
    await isolate('1', async () => {
      const page = await newPage(browser, base, inlinePage);
      check('1 no event before the visitor touches anything', (await events(page)).length === 0,
        JSON.stringify(await events(page)));

      await findSlots(page);
      await page.waitForSelector('.sw-slot', { timeout: 5000 });
      const ev = await events(page);

      const open = evt(ev, 'widget_open');
      check('1 widget_open fired once', open.length === 1, `got ${open.length}`);
      check('1 widget_open trigger is interaction', open[0]?.[1]?.trigger === 'interaction', JSON.stringify(open[0]));
      check('1 widget_open carries the brand', open[0]?.[1]?.brand === brand, JSON.stringify(open[0]?.[1]));
      check('1 widget_open says the page books', open[0]?.[1]?.lead_only === 0, JSON.stringify(open[0]?.[1]));

      const slots = evt(ev, 'widget_slots');
      check('1 widget_slots fired once', slots.length === 1, `got ${slots.length}`);
      check('1 widget_slots outcome is shown', slots[0]?.[1]?.outcome === 'shown', JSON.stringify(slots[0]));
      check('1 widget_slots counted all 3 slots', slots[0]?.[1]?.slot_count === 3, JSON.stringify(slots[0]));
      check('1 widget_slots names the instrument', slots[0]?.[1]?.instrument === 'Guitar', JSON.stringify(slots[0]));

      const steps = evt(ev, 'widget_step').map(e => e[1].step);
      check('1 reached the select step', steps.includes('select'), JSON.stringify(steps));
      check('1 reached the slots step', steps.includes('slots'), JSON.stringify(steps));
      check('1 no step counted twice', new Set(steps).size === steps.length, JSON.stringify(steps));
      check('1 nothing abandoned while still in the form', evt(ev, 'widget_abandon').length === 0);
      await page.close();
    });

    // ── 2. No slots: the coverage gap, measured ─────────────────────────────
    await isolate('2', async () => {
      const page = await newPage(browser, base, inlinePage, { availability: AVAIL_EMPTY });
      await findSlots(page);
      await page.waitForFunction(() => window.__events.some(e => e[0] === 'widget_slots'), { timeout: 5000 });
      const ev = await events(page);

      const slots = evt(ev, 'widget_slots');
      check('2 widget_slots outcome is empty', slots[0]?.[1]?.outcome === 'empty', JSON.stringify(slots[0]));
      check('2 widget_slots count is 0', slots[0]?.[1]?.slot_count === 0, JSON.stringify(slots[0]));
      check('2 widget_slots still names the city', slots[0]?.[1]?.city === city, JSON.stringify(slots[0]));

      const steps = evt(ev, 'widget_step').map(e => e[1].step);
      check('2 fell through to the lead form', steps.includes('lead_form'), JSON.stringify(steps));
      check('2 never showed a slot grid', !steps.includes('slots'), JSON.stringify(steps));
      await page.close();
    });

    // ── 3. Leaving mid-form is an abandonment ──────────────────────────────
    await isolate('3', async () => {
      const page = await newPage(browser, base, inlinePage);
      await page.waitForSelector('#sw-instrument');
      await page.select('#sw-instrument', 'Guitar');
      // A synthetic pagehide: the listener wiring is what this asserts. Real delivery
      // on a genuine navigation is the browser's guarantee, not this file's.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      const ev = await events(page);

      const ab = evt(ev, 'widget_abandon');
      check('3 widget_abandon fired once', ab.length === 1, `got ${ab.length}`);
      check('3 widget_abandon reason is pagehide', ab[0]?.[1]?.reason === 'pagehide', JSON.stringify(ab[0]));
      check('3 widget_abandon names the last step', ab[0]?.[1]?.last_step === 'select', JSON.stringify(ab[0]));

      // Idempotent: a second pagehide must not double count.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      check('3 widget_abandon does not fire twice', evt(await events(page), 'widget_abandon').length === 1);
      await page.close();
    });

    // ── 4. Never abandon somebody who finished ─────────────────────────────
    await isolate('4', async () => {
      const page = await newPage(browser, base, inlinePage,
        { availability: AVAIL_EMPTY, stripRedirect: true });
      await findSlots(page);
      await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
      await page.type('#sw-name', 'Test Parent');
      await page.type('#sw-email', 'test@example.com');
      await page.type('#sw-phone', '7605551234');
      // A booking page's lead form still asks who the lesson is for, and refuses the
      // submission without it. Only a lead-ONLY page drops the question.
      const lessonFor = await page.$('[data-lessonfor="child"]');
      if (lessonFor) await lessonFor.click();
      await page.click('#sw-submit-lead');
      await page.waitForFunction(
        () => window.__events.some(e => e[0] === 'form_submission'), { timeout: 8000 });
      // The visitor is mid-redirect. A real navigation fires pagehide here, so this is
      // the case that proves a conversion is not also counted as an abandonment.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      const ev = await events(page);
      check('4 a submitted lead fired form_submission', evt(ev, 'form_submission').length >= 1,
        JSON.stringify(ev.map(e => e[0])));
      check('4 a submitted lead is never an abandonment', evt(ev, 'widget_abandon').length === 0,
        JSON.stringify(evt(ev, 'widget_abandon')));
      await page.close();
    });

    // ── 5. Modal pages: open and close ─────────────────────────────────────
    await isolate('5', async () => {
      const page = await newPage(browser, base, modalPage);
      const hasModal = await page.evaluate(() => typeof window.openModal === 'function');
      check('5 the modal page exposes openModal', hasModal);
      if (hasModal) {
        await page.evaluate(() => window.openModal());
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'widget_open'), { timeout: 5000 });
        const open = evt(await events(page), 'widget_open');
        check('5 widget_open trigger is modal', open[0]?.[1]?.trigger === 'modal', JSON.stringify(open[0]));

        const closes = await page.evaluate(() => typeof window.closeModalDirect === 'function');
        check('5 the modal page exposes closeModalDirect', closes);
        if (closes) {
          await page.evaluate(() => window.closeModalDirect());
          const ab = evt(await events(page), 'widget_abandon');
          check('5 closing the modal is an abandonment', ab.length === 1, `got ${ab.length}`);
          check('5 widget_abandon reason is close', ab[0]?.[1]?.reason === 'close', JSON.stringify(ab[0]));
        }
      }
      await page.close();
    });

    // ── 6. A gtag that throws must not cost a booking ──────────────────────
    await isolate('6', async () => {
      const page = await newPage(browser, base, inlinePage, { hostileGtag: true });
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await findSlots(page);
      const reached = await page.waitForSelector('.sw-slot', { timeout: 5000 }).then(() => true, () => false);
      check('6 a throwing gtag still reaches the slot grid', reached);
      check('6 a throwing gtag raises no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
      await page.close();
    });

    // ── 7. gtag absent entirely ─────────────────────────────────────────────
    await isolate('7', async () => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', req => stubApi(req, AVAIL_FULL));
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.goto(`${base}${inlinePage}`, { waitUntil: 'networkidle2' });
      // No recorder at all, and gtag taken away after the page defined it: the guard
      // `typeof gtag === 'function'` is the only thing standing between the booking
      // path and a TypeError.
      await page.evaluate(() => { window.gtag = undefined; });
      await findSlots(page);
      const reached = await page.waitForSelector('.sw-slot', { timeout: 5000 }).then(() => true, () => false);
      check('7 no gtag at all still reaches the slot grid', reached);
      check('7 no gtag at all raises no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
      await page.close();
    });
    // ── 8. A broken backend is our failure, not the visitor's ──────────────
    await isolate('8', async () => {
      const page = await newPage(browser, base, inlinePage, { availabilityStatus: 500 });
      await findSlots(page);
      await page.waitForFunction(
        () => window.__events.some(e => e[0] === 'widget_error'), { timeout: 8000 });
      const ev = await events(page);

      const slots = evt(ev, 'widget_slots');
      check('8 widget_slots outcome is error', slots[0]?.[1]?.outcome === 'error', JSON.stringify(slots[0]));
      // The whole point of the distinction: a coverage gap and an outage must not
      // arrive as the same number.
      check('8 an outage is never reported as empty coverage',
        !slots.some(x => x[1].outcome === 'empty'), JSON.stringify(slots));

      const errs = evt(ev, 'widget_error');
      check('8 widget_error fired', errs.length === 1, `got ${errs.length}`);
      check('8 widget_error names the availability stage', errs[0]?.[1]?.stage === 'availability',
        JSON.stringify(errs[0]));
      await page.close();
    });

    // ── 9. Mobile backgrounding, where pagehide does not fire ──────────────
    await isolate('9', async () => {
      const page = await newPage(browser, base, inlinePage);
      await page.waitForSelector('#sw-instrument');
      await page.select('#sw-instrument', 'Guitar');
      // visibilityState is read-only, so it has to be redefined before the event
      // means anything. This is the iOS app-switch and screen-lock path.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const ab = evt(await events(page), 'widget_abandon');
      check('9 backgrounding counts as an abandonment', ab.length === 1, `got ${ab.length}`);
      check('9 it is reported as the softer hidden reason', ab[0]?.[1]?.reason === 'hidden',
        JSON.stringify(ab[0]));
      check('9 it still names the last step', ab[0]?.[1]?.last_step === 'select', JSON.stringify(ab[0]));
      await page.close();
    });

  } catch (e) {
    check('the harness itself ran to completion', false, String((e && e.message) || e));
  } finally {
    await browser.close();
    server.close();
  }

  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok || !r.detail ? '' : `  <- ${r.detail}`}`);
  }
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
})();
