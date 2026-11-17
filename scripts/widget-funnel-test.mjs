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
// Every scheduling request the widget makes, so a case can assert WHAT it asked for and
// not just what it showed. mtncitymusic's widget asked /cities with no brand until
// 2026-09-28, and its dropdown offered Music & Mastery's cities; the stub answered the
// same either way, so nothing here could see it.
const apiCalls = [];

function stubApi(req, availability, stripRedirect = false, availabilityStatus = 200) {
  const url = req.url();
  if (url.includes('/api/scheduling/') && req.method() !== 'OPTIONS') {
    apiCalls.push({ url, body: req.postData() || '' });
  }
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (/googletagmanager|google-analytics|doubleclick|gstatic|fonts\.googleapis|connect\.facebook\.net|facebook\.com/.test(url)) {
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
      // stripRedirect 'local' keeps the redirect but points it at this server's own
      // thank-you.html, so a case can follow the visitor there and read what it recorded.
      const target = stripRedirect === 'local' ? '/thank-you.html' : '';
      const html = fs.readFileSync(file, 'utf8')
        .replace(/window\.MCMC_THANK_YOU_REDIRECT\s*=\s*'[^']*'/, `window.MCMC_THANK_YOU_REDIRECT = '${target}'`);
      return req.respond({ status: 200, contentType: 'text/html', body: html });
    }
  }
  if (!url.includes('/api/scheduling/')) return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors, body: '' });
  const json = body => req.respond({ status: 200, headers: cors, contentType: 'application/json',
    body: JSON.stringify(body) });
  if (url.includes('/cities')) return json({ cities: [city, 'Somewhere Else'] });
  if (url.includes('/availability')) {
    // A function answers per request, so a case can treat the filtered search and the
    // unfiltered retry differently. It returns a body, an HTTP status, or 'abort'.
    if (typeof availability === 'function') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
      const answer = availability(body);
      if (answer === 'abort') return req.abort('failed');
      if (typeof answer === 'number') {
        return req.respond({ status: answer, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ detail: 'scheduler unavailable' }) });
      }
      return json(answer);
    }
    if (availabilityStatus === 'abort') return req.abort('failed');
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
      // The hero video reports its own muted autoplay (vsl_autoplay) without a touch, by
      // design since 2026-10-06. This check is about the booking widget's funnel events.
      const untouched = (await events(page)).filter(e => !/^vsl_/.test(e[0]));
      check('1 no widget event before the visitor touches anything', untouched.length === 0,
        JSON.stringify(untouched));

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

      const citiesCall = apiCalls.find(c => c.url.includes('/cities'));
      check('1 the city list is asked for this brand only',
        !!citiesCall && new URL(citiesCall.url).searchParams.get('brand') === brand,
        citiesCall ? citiesCall.url : 'no /cities request');
      const availCall = apiCalls.find(c => c.url.includes('/availability'));
      let availBrand;
      try { availBrand = JSON.parse(availCall?.body || '{}').brand; } catch (e) { availBrand = undefined; }
      check('1 the availability search is scoped to this brand', availBrand === brand,
        availCall ? availCall.body : 'no /availability request');
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
      await page.type('#sw-name', 'Pat Rivera');
      await page.type('#sw-email', 'pat@example.com');
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

    // ── 10. SMS opt-in (brands whose config sets smsConsent) ────────────────
    // The A2P 10DLC rules: optional, UNCHECKED by default, its own box, and the wording
    // names the business, STOP and HELP, and links privacy + terms. A ticked box has to
    // reach the server with the wording; an unticked one must never claim consent.
    if (CONFIG.smsConsent) {
      const leadBody = () => {
        const call = [...apiCalls].reverse().find(c => c.url.includes('/lead'));
        try { return JSON.parse(call?.body || '{}'); } catch (e) { return {}; }
      };
      const fillLead = async page => {
        await findSlots(page);
        await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        await page.type('#sw-phone', '7605551234');
        const lessonFor = await page.$('[data-lessonfor="child"]');
        if (lessonFor) await lessonFor.click();
      };

      await isolate('10', async () => {
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await fillLead(page);
        const box = await page.$eval('#sw-sms-consent', el => ({
          checked: el.checked, required: el.required,
          text: el.closest('label').textContent.replace(/\s+/g, ' '),
          links: [...el.closest('label').querySelectorAll('a')].map(a => a.getAttribute('href')),
        })).catch(() => null);
        check('10 the lead form shows the SMS opt-in box', !!box);
        check('10 it starts unchecked', box && box.checked === false, JSON.stringify(box));
        check('10 it is not required', box && box.required === false, JSON.stringify(box));
        const t = (box && box.text) || '';
        check('10 the wording names the business, STOP, HELP and rates',
          t.includes(CONFIG.smsBusinessName || 'Mountain City Music Co.') && /STOP/.test(t) && /HELP/.test(t) &&
          /rates may apply/i.test(t) && /frequency varies/i.test(t), t);
        check('10 it links the privacy policy and the terms',
          box && box.links.some(h => /privacy-policy/.test(h)) &&
          box.links.some(h => /terms-of-service/.test(h)), JSON.stringify(box && box.links));

        await page.click('#sw-submit-lead');
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'),
          { timeout: 8000 });
        const body = leadBody();
        check('10 an unticked box sends no consent', body.sms_consent === false && !body.sms_consent_text,
          JSON.stringify(body));
        await page.close();
      });

      await isolate('10b', async () => {
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await fillLead(page);
        await page.click('#sw-sms-consent');
        await page.click('#sw-submit-lead');
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'),
          { timeout: 8000 });
        const body = leadBody();
        check('10 a ticked box sends consent with the wording it showed',
          body.sms_consent === true && /STOP/.test(body.sms_consent_text || '') &&
          /in-home-/.test(body.sms_consent_page || ''), JSON.stringify(body));
        await page.close();
      });

      await isolate('10c', async () => {
        const page = await newPage(browser, base, inlinePage);
        await findSlots(page);
        await page.waitForSelector('.sw-slot', { timeout: 5000 });
        await page.click('.sw-slot');
        const next = await page.$('#sw-next-3');
        if (next) await next.click();
        const onBooking = await page.waitForSelector('#sw-sms-consent', { timeout: 5000 })
          .then(() => true, () => false);
        check('10 the booking form shows the SMS opt-in box too', onBooking);
        await page.close();
      });
    }

    // ── 11. Saw real times, none suited: a lead, not a coverage gap ─────────
    // The ad landing pages promise "if none of them work, leave your details and we'll
    // find one with you". Before 2026-10-06 the slot grid only offered Back, so a
    // visitor who disliked every time had no way to leave their details from it.
    await isolate('11', async () => {
      const page = await newPage(browser, base, inlinePage, { stripRedirect: true });
      // The text link sits below the grid, where the page's sticky bar covers it in an
      // 800x600 test window unless it is centred first. A visitor scrolls; the test must too.
      const tap = async sel => {
        await page.$eval(sel, el => el.scrollIntoView({ block: 'center' }));
        await page.click(sel);
      };
      await findSlots(page);
      await page.waitForSelector('#sw-none-fit', { timeout: 5000 });
      await tap('#sw-none-fit');
      await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
      const heading = await page.$eval('.sw-heading', el => el.textContent);
      const sub = await page.$eval('.sw-subtext', el => el.textContent);
      check('11 the lead form asks what times suit them', /What Times Suit You/.test(heading), heading);
      check('11 it never says we have no opening', !/don't have an opening/.test(sub), sub);
      check('11 widget_no_time_fits fired', evt(await events(page), 'widget_no_time_fits').length === 1);

      await tap('#sw-back-1');
      const backOnGrid = await page.waitForSelector('.sw-slot', { timeout: 5000 }).then(() => true, () => false);
      check('11 Back returns to the same times', backOnGrid);

      await tap('#sw-none-fit');
      await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
      await page.type('#sw-name', 'Pat Rivera');
      await page.type('#sw-email', 'pat@example.com');
      await page.type('#sw-phone', '7605551234');
      const lessonFor = await page.$('[data-lessonfor="child"]');
      if (lessonFor) await tap('[data-lessonfor="child"]');
      await tap('#sw-submit-lead');
      await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'), { timeout: 8000 });
      const call = [...apiCalls].reverse().find(c => c.url.includes('/lead'));
      let body = {};
      try { body = JSON.parse(call?.body || '{}'); } catch (e) { body = {}; }
      check('11 the lead tells Jonny why it is a lead', /none suited/.test(body.notes || ''), JSON.stringify(body));
      await page.close();
    });

    // ── 12. AI-call consent: shown and sent on the LEAD path only ──────────
    // Every lead-form send button has the disclosure directly above it, with no
    // checkbox, and the lead body carries the wording the visitor saw, but only
    // against a phone number. The booking and the "have an instructor call you
    // first" callback both post to /book and must neither show it nor send it.
    {
      const lastBody = part => {
        const call = [...apiCalls].reverse().find(c => c.url.includes(part));
        try { return JSON.parse(call?.body || '{}'); } catch (e) { return {}; }
      };
      const AI_TEXT = "By sending this form, you agree that Jonny or his AI assistant (an automated " +
        "voice) may call the number above about lessons. Agreeing isn't required to take lessons; " +
        "you can call us at (760) 573-2120 instead.";
      // The booking step's own line above Book (Jonny 2026-11-04 Q10; wording 2026-11-05).
      const BOOK_TEXT = "By booking, you agree that Jonny or his AI assistant (an automated voice) " +
        "may call the number above about lessons. Agreeing isn't required to take lessons; you can " +
        "call us at (760) 573-2120 to book instead.";
      // The disclosure must sit directly above the button: the element just before the
      // button, or just before the Back/Submit row that holds it.
      const disclosureAboveButton = page => page.evaluate(() => {
        const btn = document.getElementById('sw-submit-lead');
        if (!btn) return null;
        const row = btn.parentElement.classList.contains('sw-step2-actions') ? btn.parentElement : btn;
        const p = row.previousElementSibling;
        if (!p || !p.classList.contains('sw-ai-consent')) return { found: false };
        const cs = getComputedStyle(p);
        return { found: true, text: p.textContent.replace(/\s+/g, ' ').trim(),
          tel: p.querySelector('a[href^="tel:"]')?.getAttribute('href') || '',
          fontSize: parseFloat(cs.fontSize), color: cs.color,
          above: p.getBoundingClientRect().bottom <= btn.getBoundingClientRect().top };
      });
      const checkDisclosure = (tag, d) => {
        check(`${tag} the disclosure sits directly above the send button`, d && d.found && d.above,
          JSON.stringify(d));
        check(`${tag} it is the exact wording`, d && d.text === AI_TEXT, d && d.text);
        check(`${tag} the office number is a tap-to-call link`, d && /^tel:\+?1?7605732120$/.test(d.tel),
          d && d.tel);
        check(`${tag} it is readable (>= 12px, dark text)`, d && d.fontSize >= 12 &&
          d.color === 'rgb(51, 51, 51)', JSON.stringify(d));
      };
      const sentConsent = (tag, body) => {
        check(`${tag} the lead sends ai_call_consent with the wording and page`,
          body.ai_call_consent === true && body.ai_call_consent_text === AI_TEXT &&
          /^http:\/\/localhost:\d+\/[^?#]*\.html$/.test(body.ai_call_consent_page || ''),
          JSON.stringify(body));
      };
      const submitLeadAndWait = async page => {
        const before = apiCalls.filter(c => c.url.includes('/lead')).length;
        await page.$eval('#sw-submit-lead', el => el.scrollIntoView({ block: 'center' }));
        await page.click('#sw-submit-lead');
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'),
          { timeout: 8000 });
        return apiCalls.filter(c => c.url.includes('/lead')).length > before;
      };

      // 12a. The fallback lead form on a booking page (no times in the city).
      await isolate('12a', async () => {
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await findSlots(page);
        await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
        checkDisclosure('12a', await disclosureAboveButton(page));
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        await page.type('#sw-phone', '7605551234');
        const lessonFor = await page.$('[data-lessonfor="child"]');
        if (lessonFor) await lessonFor.click();
        check('12a the lead was sent', await submitLeadAndWait(page));
        sentConsent('12a', lastBody('/lead'));
        await page.close();
      });

      // 12b. No phone number: nothing to agree to calls on.
      await isolate('12b', async () => {
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await findSlots(page);
        await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        const lessonFor = await page.$('[data-lessonfor="child"]');
        if (lessonFor) await lessonFor.click();
        check('12b a lead with no phone was sent', await submitLeadAndWait(page));
        const body = lastBody('/lead');
        check('12b a lead with no phone sends ai_call_consent false and no wording',
          body.ai_call_consent === false && !('ai_call_consent_text' in body) &&
          !('ai_call_consent_page' in body), JSON.stringify(body));
        await page.close();
      });

      // 12c. A lead-only page: the single contact form.
      await isolate('12c', async () => {
        const page = await newPage(browser, base, CONFIG.leadOnlyPage, { stripRedirect: true });
        await page.waitForSelector('#sw-submit-lead', { timeout: 5000 });
        checkDisclosure('12c', await disclosureAboveButton(page));
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        await page.type('#sw-phone', '7605551234');
        if (await page.$('#sw-instrument')) {
          await page.select('#sw-instrument', 'Guitar');
          await page.waitForSelector('#sw-submit-lead');
        }
        const lessonFor = await page.$('[data-lessonfor="child"]');
        if (lessonFor) await lessonFor.click();
        if (await page.$('#sw-age')) await page.type('#sw-age', '8');
        if (await page.$('#sw-city-text')) {
          const v = await page.$eval('#sw-city-text', el => el.value);
          if (!v) await page.type('#sw-city-text', city);
        }
        if (await page.$('#sw-timing')) await page.select('#sw-timing', 'asap');
        check('12c the lead was sent', await submitLeadAndWait(page));
        sentConsent('12c', lastBody('/lead'));
        await page.close();
      });

      // 12d + 12e. The booking shows its own line directly above Book and sends it; the callback
      // link (no line of its own) sends no consent fields.
      const toBookingForm = async (page, withPhone = true) => {
        await findSlots(page);
        await page.waitForSelector('.sw-slot', { timeout: 5000 });
        await page.click('.sw-slot');
        const next = await page.$('#sw-next-3');
        if (next) await next.click();
        await page.waitForSelector('#sw-submit', { timeout: 5000 });
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        if (withPhone) await page.type('#sw-phone', '7605551234');
        await page.type('#sw-address-final', '1 Test St');
        const lessonFor = await page.$('[data-lessonfor="child"]');
        if (lessonFor) await lessonFor.click();
      };
      const bookLineAboveSubmit = page => page.evaluate(() => {
        const btn = document.getElementById('sw-submit');
        const p = btn && btn.previousElementSibling;
        if (!p || !p.classList.contains('sw-ai-consent')) return { found: false };
        const cs = getComputedStyle(p);
        return { found: true, text: p.textContent.replace(/\s+/g, ' ').trim(),
          tel: p.querySelector('a[href^="tel:"]')?.getAttribute('href') || '',
          fontSize: parseFloat(cs.fontSize), color: cs.color,
          above: p.getBoundingClientRect().bottom <= btn.getBoundingClientRect().top };
      });
      const sendAndRead = async (page, btn) => {
        const before = apiCalls.filter(c => c.url.includes('/book')).length;
        await page.$eval(btn, el => el.scrollIntoView({ block: 'center' }));
        await page.click(btn);
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'),
          { timeout: 8000 });
        return { posted: apiCalls.filter(c => c.url.includes('/book')).length > before, body: lastBody('/book') };
      };
      await isolate('12d', async () => {
        const page = await newPage(browser, base, inlinePage, { stripRedirect: true });
        await toBookingForm(page);
        const d = await bookLineAboveSubmit(page);
        check('12d the booking line sits directly above Book', d && d.found && d.above, JSON.stringify(d));
        check('12d it is the exact booking wording', d && d.text === BOOK_TEXT, d && d.text);
        check('12d the office number is a tap-to-call link', d && /^tel:\+?1?7605732120$/.test(d.tel), d && d.tel);
        check('12d it is readable (>= 12px, dark text)', d && d.fontSize >= 12 && d.color === 'rgb(51, 51, 51)',
          JSON.stringify(d));
        check('12d only one AI-call line on the booking step', (await page.$$('.sw-ai-consent')).length === 1);
        const { posted, body } = await sendAndRead(page, '#sw-submit');
        check('12d the booking posted to /book', posted);
        check('12d the booking sends ai_call_consent with the booking wording and page',
          body.ai_call_consent === true && body.ai_call_consent_text === BOOK_TEXT &&
          /^http:\/\/localhost:\d+\/[^?#]*\.html$/.test(body.ai_call_consent_page || ''), JSON.stringify(body));
        await page.close();
      });
      await isolate('12d2', async () => {
        const page = await newPage(browser, base, inlinePage, { stripRedirect: true });
        await toBookingForm(page, false);
        const { posted, body } = await sendAndRead(page, '#sw-submit');
        check('12d2 a booking with no phone posted to /book', posted);
        check('12d2 a booking with no phone sends ai_call_consent false and no wording',
          body.ai_call_consent === false && !('ai_call_consent_text' in body), JSON.stringify(body));
        await page.close();
      });
      await isolate('12e', async () => {
        const page = await newPage(browser, base, inlinePage, { stripRedirect: true });
        await toBookingForm(page);
        const { posted, body } = await sendAndRead(page, '#sw-callback');
        check('12e the callback posted to /book', posted);
        check('12e the callback body carries no ai_call_consent field',
          !Object.keys(body).some(k => k.startsWith('ai_call_consent')), JSON.stringify(body));
        check('12e it really was the callback', body.callback_requested === true, JSON.stringify(body));
        await page.close();
      });
    }

    // ── 14. Day/time picks: widen an empty search, carry the picks to the lead ─
    // Saturday alone finds nothing in any city, and that used to drop the visitor on the
    // lead form with no trace of what they asked for, even while real times sat on other
    // days. A filtered search that comes back empty runs once more with no filter; only
    // when that is empty too does the lead form open, and the lead carries the picks. A
    // failed search opens the lead form instead of stranding the visitor on step 1.
    {
      const WIDENED_NOTE = 'No openings on the days you picked. Here are the closest times.';
      const PICKED_DAYS = [5];
      const PICKED_TIMES = [{ start: '17:00', end: '21:00' }];
      // Filtered requests get `filtered`, unfiltered ones get `open`. Either may be a
      // number (that HTTP status) or 'abort' (a network failure).
      const byFilter = (filtered, open) => body =>
        (body.preferred_days || body.preferred_times) ? filtered : open;
      const availCalls = () => apiCalls.filter(c => c.url.includes('/availability'))
        .map(c => { try { return JSON.parse(c.body || '{}'); } catch (e) { return {}; } });
      const lastLead = () => {
        const call = [...apiCalls].reverse().find(c => c.url.includes('/lead'));
        try { return JSON.parse(call?.body || '{}'); } catch (e) { return {}; }
      };
      const tap = async (page, sel) => {
        await page.$eval(sel, el => el.scrollIntoView({ block: 'center' }));
        await page.click(sel);
      };
      const findWithPicks = async page => {
        await page.waitForSelector('#sw-instrument');
        await page.select('#sw-instrument', 'Guitar');
        if (await page.$('#sw-city')) {
          const has = await page.$$eval('#sw-city option', (o, c) => o.some(x => x.value === c), city);
          if (has) await page.select('#sw-city', city);
        }
        await tap(page, '.sw-pill[data-day="5"]');
        await tap(page, '.sw-pill[data-time="evening"]');
        await tap(page, '#sw-find');
      };
      const submitLead = async page => {
        await page.waitForSelector('#sw-submit-lead', { timeout: 8000 });
        await page.type('#sw-name', 'Pat Rivera');
        await page.type('#sw-email', 'pat@example.com');
        await page.type('#sw-phone', '7605551234');
        if (await page.$('[data-lessonfor="child"]')) await tap(page, '[data-lessonfor="child"]');
        await tap(page, '.sw-pill[data-howheard="1"]');   // "How did you hear about us?" TikTok
        const before = apiCalls.filter(c => c.url.includes('/lead')).length;
        await tap(page, '#sw-submit-lead');
        await page.waitForFunction(() => window.__events.some(e => e[0] === 'form_submission'),
          { timeout: 8000 });
        return apiCalls.filter(c => c.url.includes('/lead')).length > before;
      };
      const leadCarriesPicks = (tag, body) => {
        check(`${tag} the lead carries the picked days`,
          JSON.stringify(body.preferred_days) === JSON.stringify(PICKED_DAYS), JSON.stringify(body));
        check(`${tag} the lead carries the picked times`,
          JSON.stringify(body.preferred_times) === JSON.stringify(PICKED_TIMES), JSON.stringify(body));
        check(`${tag} the lead carries the city`, body.city === city, JSON.stringify(body));
        check(`${tag} the lead carries how they heard about us`, body.how_heard === 'TikTok', JSON.stringify(body));
      };
      const leadSubtext = page => page.$eval('.sw-subtext', el => el.textContent);

      // 14a. Picks find nothing, the open search finds times: shown, with the line.
      await isolate('14a', async () => {
        const start = apiCalls.length;
        const page = await newPage(browser, base, inlinePage,
          { availability: byFilter(AVAIL_EMPTY, AVAIL_FULL) });
        await findWithPicks(page);
        await page.waitForSelector('.sw-slot', { timeout: 8000 });
        const calls = apiCalls.slice(start).filter(c => c.url.includes('/availability'))
          .map(c => JSON.parse(c.body || '{}'));
        check('14a searched twice', calls.length === 2, JSON.stringify(calls));
        check('14a the first search sent the picks',
          JSON.stringify(calls[0]?.preferred_days) === JSON.stringify(PICKED_DAYS) &&
          JSON.stringify(calls[0]?.preferred_times) === JSON.stringify(PICKED_TIMES), JSON.stringify(calls[0]));
        check('14a the second search had no day/time filter',
          calls[1] && !('preferred_days' in calls[1]) && !('preferred_times' in calls[1]) &&
          calls[1].city === city && calls[1].instrument === 'Guitar', JSON.stringify(calls[1]));
        const note = await page.$eval('.sw-widened-note', el => el.textContent.trim()).catch(() => null);
        check('14a the line above the times is the exact wording', note === WIDENED_NOTE, String(note));
        const above = await page.evaluate(() => {
          const n = document.querySelector('.sw-widened-note');
          const s = document.querySelector('.sw-slots-container');
          return !!(n && s && (n.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        check('14a the line sits above the times', above);
        const slots = evt(await events(page), 'widget_slots');
        check('14a widget_slots fired once, shown, widened',
          slots.length === 1 && slots[0][1].outcome === 'shown' && slots[0][1].widened === 1 &&
          slots[0][1].slot_count === 3, JSON.stringify(slots));
        await page.close();
      });

      // 14b. A plain search that finds times shows no line and searches once.
      await isolate('14b', async () => {
        const start = apiCalls.length;
        const page = await newPage(browser, base, inlinePage);
        await findSlots(page);
        await page.waitForSelector('.sw-slot', { timeout: 8000 });
        check('14b no line when nothing was filtered out', !(await page.$('.sw-widened-note')));
        check('14b searched once', apiCalls.slice(start).filter(c => c.url.includes('/availability')).length === 1);
        await page.close();
      });

      // 14c. Both searches empty: the lead form, and the lead carries the picks.
      await isolate('14c', async () => {
        const start = apiCalls.length;
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await findWithPicks(page);
        await page.waitForSelector('#sw-submit-lead', { timeout: 8000 });
        check('14c searched twice before giving up',
          apiCalls.slice(start).filter(c => c.url.includes('/availability')).length === 2);
        const sub = await leadSubtext(page);
        check('14c with nothing open at all, it says there is no opening', /don't have an opening/.test(sub), sub);
        const slots = evt(await events(page), 'widget_slots');
        check('14c widget_slots fired once, empty, widened',
          slots.length === 1 && slots[0][1].outcome === 'empty' && slots[0][1].widened === 1, JSON.stringify(slots));
        check('14c the lead was sent', await submitLead(page));
        leadCarriesPicks('14c', lastLead());
        await page.close();
      });

      // 14d. No picks: the lead leaves the keys out entirely.
      await isolate('14d', async () => {
        const page = await newPage(browser, base, inlinePage,
          { availability: AVAIL_EMPTY, stripRedirect: true });
        await findSlots(page);
        check('14d the lead was sent', await submitLead(page));
        const body = lastLead();
        check('14d a lead with no picks sends no preferred_* keys',
          !('preferred_days' in body) && !('preferred_times' in body), JSON.stringify(body));
        await page.close();
      });

      // 14e-g. The search fails (5xx, network, or the widened retry): the lead form opens.
      for (const [tag, what, availability, availabilityStatus] of [
        ['14e', 'a 5xx', AVAIL_FULL, 503],
        ['14f', 'a network failure', AVAIL_FULL, 'abort'],
        ['14g', 'a failed widened retry', byFilter(AVAIL_EMPTY, 500), 200],
      ]) {
        await isolate(tag, async () => {
          const page = await newPage(browser, base, inlinePage,
            { availability, availabilityStatus, stripRedirect: true });
          await findWithPicks(page);
          const reached = await page.waitForSelector('#sw-submit-lead', { timeout: 8000 })
            .then(() => true, () => false);
          check(`${tag} ${what} opens the lead form`, reached);
          if (!reached) { await page.close(); return; }
          const sub = await leadSubtext(page);
          check(`${tag} ${what} never claims there is no opening`, !/don't have an opening/.test(sub), sub);
          const errs = evt(await events(page), 'widget_error');
          check(`${tag} ${what} is still reported as widget_error`,
            errs.length === 1 && errs[0][1].stage === 'availability', JSON.stringify(errs));
          check(`${tag} the lead was sent`, await submitLead(page));
          leadCarriesPicks(tag, lastLead());
          await page.close();
        });
      }
    }

    // ── 16. Black Friday page (one campaign, remove after Dec 18, 2026) ────────────────
    // Jonny 2026-11-12: a filmed ad says "we can get you started as early as next week", so the
    // page offers "Right away" (sent as "asap") beside December and January; from December 1
    // "Right away" already means December, so December is hidden; from December 19 the form is
    // gone. Review 2026-11-12: the form shows only once the spots counter answers 200; a sold-out
    // reply or a counter at 0 shows sold out; a rehearsal is marked test=1 and records no
    // conversion; the page's test rule is the lead API's. Every wait below resolves on a request
    // the page makes, never on a timeout that is swallowed.
    {
      const BF_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      const NOV = '2026-11-12T20:00:00Z';
      // The enhanced-conversion details the BF page stashes for its thanks page (USER_DATA_KEY).
      const EC_KEY = 'mm_ec_user_data';
      const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms))]);
      let bfSeq = 0;
      // The page at a fixed moment (Date replaced before any page script runs), its API stubbed:
      // `spots` is the counter's answer ({ status, body } or 'abort'), `lead` the signup reply.
      const bfPage = async (route, isoNow, { spots = { status: 200, body: { offer: 'bf60', cap: 15,
        spots_left: 9, open: true, ends: '2026-12-18' } }, lead = { success: true, lead_id: 1,
        spots_left: 8, message: 'ok' } } = {}) => {
        const page = await browser.newPage();
        const posts = [], navs = [], events = [], metaReqs = [];
        let gotPost, gotNav;
        const firstPost = new Promise(r => { gotPost = r; });
        const firstNav = new Promise(r => { gotNav = r; });
        const hook = `__bfEvent${++bfSeq}`;
        await page.exposeFunction(hook, name => events.push(name));
        await page.evaluateOnNewDocument((fixed, hookName) => {
          const RealDate = Date;
          class FixedDate extends RealDate {
            constructor(...a) { super(...(a.length ? a : [fixed])); }
            static now() { return fixed; }
          }
          window.Date = FixedDate;
          window.dataLayer = window.dataLayer || [];
          const push = window.dataLayer.push.bind(window.dataLayer);
          window.dataLayer.push = function () {
            for (const a of arguments) {
              const arr = Array.from(a || []);
              if (arr[0] === 'event') try { window[hookName](arr[1]); } catch (e) {}
            }
            return push.apply(null, arguments);
          };
        }, Date.parse(isoNow), hook);
        await page.setRequestInterception(true);
        page.on('request', req => {
          const url = req.url();
          // Meta too (the pixel, 16r): recorded, then refused, so no test hit ever reaches the ad account.
          if (/connect\.facebook\.net|facebook\.com/.test(url)) { metaReqs.push(url); return req.abort(); }
          if (/googletagmanager|google-analytics|doubleclick|gstatic|fonts\.googleapis|googleusercontent/.test(url)) {
            return req.abort();
          }
          if (req.isNavigationRequest() && url.includes('black-friday-thanks')) {
            navs.push(url);
            gotNav(url);
            return req.respond({ status: 200, contentType: 'text/html', body: '<p>thanks</p>' });
          }
          if (!url.includes('/api/scheduling/')) return req.continue();
          if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: BF_CORS, body: '' });
          const json = (status, body) => req.respond({ status, headers: BF_CORS, contentType: 'application/json',
            body: JSON.stringify(body) });
          if (url.includes('/offers/bf60/spots')) {
            if (spots === 'abort') return req.abort('failed');
            return json(spots.status, spots.body || { detail: 'Not Found' });
          }
          if (url.includes('/lead')) {
            try { posts.push(JSON.parse(req.postData() || '{}')); } catch (e) { posts.push({}); }
            gotPost(posts[posts.length - 1]);
            return json(200, lead);
          }
          return json(200, {});
        });
        await page.goto(`${base}${route}`, { waitUntil: 'networkidle2' });
        return { page, posts, navs, events, metaReqs, firstPost, firstNav };
      };
      const shown = (page, sel) => page.$eval(sel, el => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      }).catch(() => false);
      // Each start choice as the visitor sees it: its value, its label, and whether it shows.
      const startChoices = page => page.$$eval('input[name="start_timing"]', els => els.map(el => {
        const label = el.closest('label');
        const box = label.getBoundingClientRect();
        return { value: el.value, text: label.textContent.trim(), shown: box.width > 0 && box.height > 0,
          required: el.required };
      }));
      // Fill the form and send it; returns the one body this submit posted.
      const fillAndSend = async (bf, { start = 'asap', name = 'Pat Rivera', email = 'pat@example.com',
        gift = null } = {}) => {
        const { page, posts, firstPost } = bf;
        await page.$eval('#bf-form', el => el.scrollIntoView());
        if (gift) {
          await page.$eval('#bf-gift', el => el.click());
          await page.type('#bf-gift-name', gift.name);
          await page.type('#bf-gift-email', gift.email);
          if (gift.phone) await page.type('#bf-gift-phone', gift.phone);
        }
        await page.$eval('input[name="lesson_for"][value="child"]', el => el.closest('label').click());
        await page.type('#bf-name', name);
        await page.type('#bf-email', email);
        await page.type('#bf-phone', '7605551234');
        await page.select('#bf-instrument', 'Piano');
        await page.type('#bf-city', city);
        await page.$eval(`input[name="start_timing"][value="${start}"]`, el => el.closest('label').click());
        await page.click('#bf-submit');
        const body = await within(firstPost, 5000, 'signup POST');
        if (posts.length !== 1) throw new Error(`expected one POST, saw ${posts.length}`);
        return body;
      };

      // 16a. November: three choices, in order, all shown, and the Christmas line stays.
      await isolate('16a', async () => {
        const { page } = await bfPage('/black-friday.html', NOV);
        const choices = await startChoices(page);
        check('16a the picker offers Right away, December and January, in that order',
          JSON.stringify(choices.map(c => [c.value, c.text])) ===
          JSON.stringify([['asap', 'As soon as next week'], ['december', 'December'], ['january', 'January']]),
          JSON.stringify(choices));
        check('16a all three are shown in November', choices.every(c => c.shown), JSON.stringify(choices));
        check('16a the required choice is one that is always shown',
          choices.filter(c => c.required).map(c => c.value).join() === 'asap', JSON.stringify(choices));
        check('16a the Christmas line is still under the picker',
          (await page.content()).includes('Giving it to your child for Christmas? Pick a January start.'));
        await page.close();
      });

      // 16b. "Right away" posts "asap", tagged with the offer, the brand and the ad that brought them,
      //      and a real family goes to the thanks page with a form_submission event and no test flag.
      await isolate('16b', async () => {
        const bf = await bfPage('/black-friday.html?fbclid=BF-FB-1&utm_campaign=bf60', NOV);
        const sentBody = await fillAndSend(bf, { start: 'asap' });
        check('16b Right away is sent as start_timing "asap"', sentBody.start_timing === 'asap',
          JSON.stringify(sentBody));
        check('16b the signup carries offer bf60 and this brand',
          sentBody.offer === 'bf60' && sentBody.brand_source === brand, JSON.stringify(sentBody));
        const at = sentBody.attribution || {};
        check('16b it carries the first-touch ad tags as attribution',
          at.fbclid === 'BF-FB-1' && at.utm_campaign === 'bf60' && at.landing === '/black-friday.html' &&
          typeof at.first_seen === 'string' && !('source' in sentBody), JSON.stringify(sentBody));
        const nav = await within(bf.firstNav, 5000, 'thanks navigation');
        check('16b a real family lands on the thanks page with no test flag',
          /type=lead/.test(nav) && !/test=1/.test(nav) && !/gift=1/.test(nav), nav);
        check('16b a real family fires form_submission', bf.events.includes('form_submission'),
          bf.events.join());
        await bf.page.close();
      });

      // 16c. December and January post their own values (one POST each, read from that submit).
      for (const start of ['december', 'january']) {
        await isolate(`16c ${start}`, async () => {
          const bf = await bfPage('/black-friday.html', NOV);
          const sentBody = await fillAndSend(bf, { start });
          check(`16c ${start} is sent as start_timing "${start}"`, sentBody.start_timing === start,
            JSON.stringify(sentBody));
          await bf.page.close();
        });
      }

      // 16d. From December 1 (Pacific), December is hidden and Right away still sends.
      await isolate('16d', async () => {
        const bf = await bfPage('/black-friday.html', '2026-12-01T08:30:00Z');
        const visible = (await startChoices(bf.page)).filter(c => c.shown).map(c => c.value);
        check('16d on December 1 the picker shows Right away and January only',
          visible.join() === 'asap,january', visible.join());
        const sentBody = await fillAndSend(bf, { start: 'asap' });
        check('16d a December signup still sends "asap"', sentBody.start_timing === 'asap',
          JSON.stringify(sentBody));
        await bf.page.close();
      });

      // 16e. November 30 at 11:30 PM Pacific is still November: December still shows.
      await isolate('16e', async () => {
        const { page } = await bfPage('/black-friday.html', '2026-12-01T07:30:00Z');
        const visible = (await startChoices(page)).filter(c => c.shown).map(c => c.value);
        check('16e late on November 30 Pacific all three still show', visible.join() === 'asap,december,january',
          visible.join());
        await page.close();
      });

      // 16f. December 19 (Pacific): the offer has ended and the form is not shown.
      await isolate('16f', async () => {
        const { page } = await bfPage('/black-friday.html', '2026-12-19T20:00:00Z');
        check('16f after December 18 the form is gone', !(await shown(page, '#bf-form')));
        await page.close();
      });

      // 16g. The form waits for the counter: a 404 (the lead API without the offer: a site shipped
      //      first, or a rollback) or no answer shows the call-us note, never the form.
      for (const [label, spots] of [['404', { status: 404 }], ['500', { status: 500 }], ['no answer', 'abort']]) {
        await isolate(`16g ${label}`, async () => {
          const { page } = await bfPage('/black-friday.html', NOV, { spots });
          check(`16g counter ${label}: the form is not shown`, !(await shown(page, '#bf-form')));
          check(`16g counter ${label}: the call-us note is shown`, await shown(page, '#bf-unavailable'));
          await page.close();
        });
      }
      await isolate('16g 200', async () => {
        const { page } = await bfPage('/black-friday.html', NOV);
        check('16g counter 200: the form is shown and the note is not',
          (await shown(page, '#bf-form')) && !(await shown(page, '#bf-unavailable')));
        check('16g counter 200: the count is shown', (await page.$eval('[data-bf-count]', el => el.textContent)) === '9');
        await page.close();
      });

      // 16h. The page's rehearsal rule is the lead API's is_rehearsal_signup (the same table as
      //      test_offer_lead.py's test_the_rehearsal_rule).
      await isolate('16h', async () => {
        const { page } = await bfPage('/black-friday.html', NOV);
        const table = [
          [['ZZTEST Mia', 'mia@x.com'], true], [['Mia', 'zztest@x.com'], true], [['mia zztest', ''], true],
          [['Test', 'a@x.com'], true], [['test Smith', 'a@x.com'], true], [['Ana', 'TEST@x.com'], true],
          [['Ana', 'a@x.com', 'ZZTEST Giver', 'g@x.com'], true], [['Ana', 'a@x.com', 'Gia', 'test@x.com'], true],
          [['Testa Rossi', 'a@x.com'], false], [['Ana', 'contest@x.com'], false], [['Ana', 'atest@x.com'], false],
          [['Ana', 'a@x.com', 'Gia', 'g@x.com'], false], [['', null], false],
        ];
        const got = await page.evaluate(rows => rows.map(([a]) => window.MCMC_BF_IS_TEST({
          client_name: a[0], email: a[1], gift_from_name: a[2], gift_from_email: a[3] })), table);
        const wrong = table.filter((row, i) => got[i] !== row[1]).map(r => JSON.stringify(r[0]));
        check('16h the page and the lead API agree on every rehearsal case', wrong.length === 0, wrong.join(' '));
        await page.close();
      });

      // 16i. A rehearsal goes to the thanks page with test=1 and fires no form_submission; a gift
      //      sends the giver's details and gift=1.
      await isolate('16i', async () => {
        const bf = await bfPage('/black-friday.html', NOV);
        const sentBody = await fillAndSend(bf, { name: 'Ana Friend', email: 'ana@example.com',
          gift: { name: 'ZZTEST Giver', email: 'giver@example.com', phone: '7605550199' } });
        check('16i a gift sends the giver\'s name, email and phone',
          sentBody.gift_from_name === 'ZZTEST Giver' && sentBody.gift_from_email === 'giver@example.com' &&
          sentBody.gift_from_phone === '7605550199' && sentBody.client_name === 'Ana Friend',
          JSON.stringify(sentBody));
        const nav = await within(bf.firstNav, 5000, 'thanks navigation');
        check('16i a rehearsal gift lands on thanks with test=1 and gift=1', /test=1/.test(nav) && /gift=1/.test(nav), nav);
        check('16i a rehearsal fires no form_submission', !bf.events.includes('form_submission'), bf.events.join());
        await bf.page.close();
      });

      // 16j. Sold out while they filled the form: the reply flips the page, nothing navigates.
      await isolate('16j', async () => {
        const bf = await bfPage('/black-friday.html', NOV, { lead: { success: false, sold_out: true, spots_left: 0 } });
        await fillAndSend(bf);
        await bf.page.waitForFunction(() => document.documentElement.classList.contains('bf-soldout'), { timeout: 5000 });
        check('16j a sold-out reply hides the form and shows sold out',
          !(await shown(bf.page, '#bf-form')) && (await shown(bf.page, '#form .bf-soldout-msg')));
        check('16j a sold-out reply stays on the page with no conversion event',
          bf.navs.length === 0 && !bf.events.includes('form_submission'), bf.navs.join() + ' ' + bf.events.join());
        await bf.page.close();
      });

      // 16k. The counter at 0 shows sold out from the first paint of the answer.
      await isolate('16k', async () => {
        const { page } = await bfPage('/black-friday.html', NOV, { spots: { status: 200, body: { offer: 'bf60',
          cap: 15, spots_left: 0, open: false, ends: '2026-12-18' } } });
        check('16k a counter at 0 shows sold out, not the form',
          (await page.evaluate(() => document.documentElement.classList.contains('bf-soldout'))) &&
          !(await shown(page, '#bf-form')) && (await shown(page, '#form .bf-soldout-msg')));
        await page.close();
      });

      // 16o. A repeat reply (the family already holds a spot) is not a new lead: thanks with repeat=1,
      //      no form_submission and no enhanced-conversion details (review 2026-11-14).
      await isolate('16o', async () => {
        const bf = await bfPage('/black-friday.html', NOV, { lead: { success: true, lead_id: 1, repeat: true,
          spots_left: 8, message: 'ok' } });
        await fillAndSend(bf, {});
        const nav = await within(bf.firstNav, 5000, 'thanks navigation');
        check('16o a repeat lands on thanks with repeat=1 and no test flag', /repeat=1/.test(nav) && !/test=1/.test(nav), nav);
        check('16o a repeat fires no form_submission', !bf.events.includes('form_submission'), bf.events.join());
        await bf.page.waitForFunction(() => /thanks/.test(document.body ? document.body.textContent : ''), { timeout: 5000 });
        const stash = await bf.page.evaluate(k => sessionStorage.getItem(k), EC_KEY);
        check('16o a repeat stashes no enhanced-conversion details', stash === null, String(stash));
        await bf.page.close();
      });

      // 16p. A real gift: enhanced conversions get the giver's details (the person on the device),
      //      not the friend's (review 2026-11-14).
      await isolate('16p', async () => {
        const bf = await bfPage('/black-friday.html', NOV);
        await fillAndSend(bf, { name: 'Ana Friend', email: 'ana@example.com',
          gift: { name: 'Gina Giver', email: 'gina@example.com', phone: '7605550199' } });
        const nav = await within(bf.firstNav, 5000, 'thanks navigation');
        check('16p a real gift lands on thanks with gift=1 and no test flag', /gift=1/.test(nav) && !/test=1/.test(nav), nav);
        await bf.page.waitForFunction(() => /thanks/.test(document.body ? document.body.textContent : ''), { timeout: 5000 });
        const stash = JSON.parse(await bf.page.evaluate(k => sessionStorage.getItem(k), EC_KEY) || '{}');
        check('16p a gift stashes the giver\'s email and phone, not the friend\'s',
          stash.email === 'gina@example.com' && stash.phone_number === '+17605550199', JSON.stringify(stash));
        await bf.page.close();
      });

      // 16l. The thanks page: a rehearsal (test=1) records no conversion, a real one does.
      for (const [qs, expect] of [['?type=lead&test=1', false], ['?type=lead', true], ['?type=lead&test=1&gift=1', false], ['?type=lead&repeat=1', false], ['?type=lead&repeat=1&gift=1', false]]) {
        await isolate(`16l ${qs}`, async () => {
          const page = await browser.newPage();
          const events = [];
          const hook = `__bfThanks${++bfSeq}`;
          await page.exposeFunction(hook, name => events.push(name));
          await page.evaluateOnNewDocument(hookName => {
            window.dataLayer = window.dataLayer || [];
            const push = window.dataLayer.push.bind(window.dataLayer);
            window.dataLayer.push = function () {
              for (const a of arguments) {
                const arr = Array.from(a || []);
                if (arr[0] === 'event') try { window[hookName](arr[1]); } catch (e) {}
              }
              return push.apply(null, arguments);
            };
          }, hook);
          await page.setRequestInterception(true);
          page.on('request', req => /googletagmanager|google-analytics|doubleclick|gstatic|googleusercontent|connect\.facebook\.net|facebook\.com/
            .test(req.url()) ? req.abort() : req.continue());
          await page.goto(`${base}/black-friday-thanks.html${qs}`, { waitUntil: 'load' });
          await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
          check(`16l thanks${qs} ${expect ? 'records' : 'records no'} conversion`,
            events.includes('conversion') === expect, events.join());
          await page.close();
        });
      }

      // 16q. The thanks page's line: a repeat says the spot covers one student (siblings never get one,
      //      Jonny 2026-11-14), a repeat gift promises nothing, a first gift and a signup keep theirs.
      //      Whole lines, word for word as approved, so a lost sentence can't pass (review 2026-11-15).
      for (const [qs, line] of [
        ['?type=lead&repeat=1', "Thank you. Your family already has a Black Friday spot, and it covers one student. We'll reach out within 24 hours."],
        ['?type=lead&repeat=1&gift=1', "Thank you. We'll reach out to you within 24 hours about this gift."],
        ['?type=lead&gift=1', "Thank you. Your gift holds one of the 15 spots. We'll reach out to your friend within 24 hours, and we'll send you the $60 invoice."],
        ['?type=lead', "Thank you. We'll reach out within 24 hours to match a teacher and a weekly time, then send your $60 invoice."],
      ]) {
        await isolate(`16q ${qs}`, async () => {
          const page = await browser.newPage();
          await page.setRequestInterception(true);
          page.on('request', req => /googletagmanager|google-analytics|doubleclick|gstatic|googleusercontent|connect\.facebook\.net|facebook\.com/
            .test(req.url()) ? req.abort() : req.continue());
          await page.goto(`${base}/black-friday-thanks.html${qs}`, { waitUntil: 'load' });
          const sub = await page.$eval('#ty-sub', el => el.textContent);
          check(`16q thanks${qs} says the approved line`, sub.trim() === line, sub);
          await page.close();
        });
      }

      // 16r. The Meta pixel (the Black Friday ads run on Facebook and Instagram), review 2026-11-15.
      //      One pixel id in every place on both pages (init, autoConfig, the landing noscript), and not
      //      the stand-in. autoConfig is off before init (Meta's Manual Only mode), so nothing fires
      //      once a visitor starts typing. The landing page records PageView and adds fbevents.js only
      //      after its first paint. The thanks page records no PageView, and one Lead exactly where the
      //      Google conversion fires (16l), never again on a refresh. No test request reaches Meta.
      const pixelSrc = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
      const idsIn = src => [...src.matchAll(/fbq\('(?:init|set)'[^)]*?'(\d+)'\)|facebook\.com\/tr\?id=(\d+)/g)]
        .map(m => m[1] || m[2]);
      const landingIds = idsIn(pixelSrc('black-friday.html'));
      const thanksIds = idsIn(pixelSrc('black-friday-thanks.html'));
      const pixelId = landingIds[0];
      check('16r one Meta pixel id in every place on both pages (init, autoConfig, noscript)',
        landingIds.length === 3 && thanksIds.length === 2 && /^\d{15,16}$/.test(pixelId || '') &&
        [...landingIds, ...thanksIds].every(id => id === pixelId), JSON.stringify({ landingIds, thanksIds }));
      // Red until Kevin's id replaces the stand-in, so the stand-in can never ship by accident.
      check('16r the pixel id is the real one, not the stand-in', pixelId !== '1234567890123456', String(pixelId));
      check('16r the landing page sends no Lead of its own (the thanks page owns it)',
        !/fbq\(\s*'track'\s*,\s*'Lead'/.test(pixelSrc('black-friday.html')), 'black-friday.html calls fbq track Lead');
      const fbqCalls = page => page.evaluate(() => window.__fbq);
      const isCall = (c, a, b) => c[0] === a && c[1] === b;
      // autoConfig off for this pixel, set before its init.
      const manualOnly = calls => {
        const set = calls.findIndex(c => isCall(c, 'set', 'autoConfig') && c[2] === false && c[3] === pixelId);
        const init = calls.findIndex(c => isCall(c, 'init', pixelId));
        return set !== -1 && init !== -1 && set < init;
      };
      const queuedCalls = page => page.evaluate(() =>
        ((window.fbq && window.fbq.queue) || []).map(a => Array.from(a)));
      for (const [qs, expect] of [['?type=lead', true], ['?type=lead&gift=1', true], ['?type=lead&test=1', false],
        ['?type=lead&test=1&gift=1', false], ['?type=lead&repeat=1', false], ['?type=lead&repeat=1&gift=1', false]]) {
        await isolate(`16r ${qs}`, async () => {
          const page = await browser.newPage();
          // The pixel snippet steps aside when fbq already exists (`if (f.fbq) return;`), so this
          // recorder owns every call and fbevents.js is never fetched.
          await page.evaluateOnNewDocument(() => {
            window.__fbq = [];
            window.fbq = function () { window.__fbq.push(Array.from(arguments)); };
          });
          await page.setRequestInterception(true);
          page.on('request', req => /googletagmanager|google-analytics|doubleclick|gstatic|googleusercontent|connect\.facebook\.net|facebook\.com/
            .test(req.url()) ? req.abort() : req.continue());
          await page.goto(`${base}/black-friday-thanks.html${qs}`, { waitUntil: 'load' });
          await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
          const calls = await fbqCalls(page);
          check(`16r thanks${qs} inits the pixel in Manual Only mode and records no PageView`,
            manualOnly(calls) && !calls.some(c => isCall(c, 'track', 'PageView')), JSON.stringify(calls));
          const leads = calls.filter(c => isCall(c, 'track', 'Lead'));
          check(`16r thanks${qs} ${expect ? 'records one' : 'records no'} Meta Lead`,
            leads.length === (expect ? 1 : 0) && (!expect || leads[0][2].content_name ===
              (qs.includes('gift=1') ? 'black_friday_60_gift' : 'black_friday_60')), JSON.stringify(calls));
          if (expect) {
            await page.reload({ waitUntil: 'load' });
            await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
            const again = await fbqCalls(page);
            check(`16r thanks${qs} refreshed records no second Lead`,
              manualOnly(again) && !again.some(c => isCall(c, 'track', 'Lead')), JSON.stringify(again));
          }
          await page.close();
        });
      }
      // The shipped path on the thanks page, no recorder: the page's own stub queues Manual Only, init
      // and the gated Lead, and asks for fbevents.js (refused here).
      await isolate('16r thanks real stub', async () => {
        const page = await browser.newPage();
        const asked = [];
        await page.setRequestInterception(true);
        page.on('request', req => {
          const url = req.url();
          if (/connect\.facebook\.net|facebook\.com/.test(url)) { asked.push(url); return req.abort(); }
          return /googletagmanager|google-analytics|doubleclick|gstatic|googleusercontent/.test(url)
            ? req.abort() : req.continue();
        });
        await page.goto(`${base}/black-friday-thanks.html?type=lead`, { waitUntil: 'load' });
        await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
        const queued = await queuedCalls(page);
        check('16r thanks (real stub) queues Manual Only, init and one Lead, and no PageView',
          manualOnly(queued) && !queued.some(c => isCall(c, 'track', 'PageView')) &&
          queued.filter(c => isCall(c, 'track', 'Lead')).length === 1, JSON.stringify(queued));
        check('16r thanks (real stub) asks for fbevents.js', asked.some(u => u.includes('/en_US/fbevents.js')),
          asked.join() || 'no request');
        await page.close();
      });
      await isolate('16r landing', async () => {
        const bf = await bfPage('/black-friday.html', NOV);
        const queued = await queuedCalls(bf.page);
        check('16r the landing page queues Manual Only, init and PageView',
          manualOnly(queued) && queued.some(c => isCall(c, 'track', 'PageView')), JSON.stringify(queued));
        const t0 = Date.now();
        while (!bf.metaReqs.some(u => u.includes('/en_US/fbevents.js')) && Date.now() - t0 < 4000) {
          await new Promise(r => setTimeout(r, 50));
        }
        check('16r the landing page asks for fbevents.js (refused here, so nothing reaches Meta)',
          bf.metaReqs.some(u => u.includes('connect.facebook.net/en_US/fbevents.js')), bf.metaReqs.join() || 'no request');
        await bf.page.close();
      });
      // The reason the landing page has its own loader is speed (the 2026-10-19 note): fbevents.js
      // must go in after the first paint, timed inside the page.
      await isolate('16r landing paint order', async () => {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
          window.__fbAt = null;
          new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
              if (window.__fbAt === null && n.tagName === 'SCRIPT' && /fbevents\.js/.test(n.src || '')) {
                window.__fbAt = performance.now();
              }
            }
          }).observe(document, { childList: true, subtree: true });
        });
        await page.setRequestInterception(true);
        page.on('request', req => /googletagmanager|google-analytics|doubleclick|gstatic|fonts\.googleapis|googleusercontent|connect\.facebook\.net|facebook\.com|\/api\/scheduling\//
          .test(req.url()) ? req.abort() : req.continue());
        await page.goto(`${base}/black-friday.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__fbAt !== null, { polling: 100, timeout: 4000 });
        const t = await page.evaluate(() => ({ fb: window.__fbAt,
          fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime }));
        check('16r the landing page adds fbevents.js only after its first paint',
          typeof t.fcp === 'number' && t.fb >= t.fcp, JSON.stringify(t));
        await page.close();
      });

      // 16m. The homepage bar: shown in the window while open, gone when the counter says closed.
      for (const [label, iso, open, expect] of [['open', NOV, true, true], ['sold out', NOV, false, false],
        ['after Dec 18', '2026-12-19T20:00:00Z', true, false]]) {
        await isolate(`16m ${label}`, async () => {
          const { page } = await bfPage('/index.html', iso, { spots: { status: 200, body: { offer: 'bf60',
            cap: 15, spots_left: open ? 9 : 0, open, ends: '2026-12-18' } } });
          await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
          check(`16m the homepage bar is ${expect ? 'shown' : 'hidden'} (${label})`,
            (await shown(page, '#bf-promo, #promo-bar')) === expect);
          await page.close();
        });
      }

      // 16n. /black-friday (no .html) redirects to the page; the catch-all rewrite would serve the
      //      homepage. Vercel runs redirects before rewrites, so the rule only has to exist.
      {
        const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
        const rule = (vercel.redirects || []).find(r => r.source === '/black-friday');
        check('16n /black-friday redirects to /black-friday.html (temporary)',
          rule && rule.destination === '/black-friday.html' && rule.permanent === false &&
          fs.existsSync(path.join(ROOT, 'black-friday.html')), JSON.stringify(rule));
      }
    }

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
